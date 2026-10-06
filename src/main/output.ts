import { nativeImage, screen, type BrowserWindow } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { FrameRepeater } from './frame-repeater'
import { createOutputWindow, type OutputOptions, type PaintStats } from './output-window'
import { Send } from '../shared/ipc'

const RESTART_DELAY_MS = 1000
/** After `output:ready`, force a repaint if no paint arrived within this time. */
const READY_REPAINT_MS = 250

/** Counters and frame dump, only exposed when PPT_OUTPUT_DUMP is set (dev/e2e). */
export interface OutputDebug {
  /** Size and fps this output renders at. */
  options: OutputOptions
  paints: number
  sent: number
  lastLength: number
  restarts: number
  /** How many times a window of this output became ready (see `onReady`). */
  readies: number
  /** Scale factor, window DIP size, painted bitmap size, fit mode and per-paint ms. */
  paint: PaintStats
  /** Writes the latest frame as `output-<n>.png` into the dump dir; returns its path. */
  dump(): string | null
  /** [b, g, r, a] of the latest frame at (x, y), or null before the first frame. */
  pixel(x: number, y: number): number[] | null
  /** Simulates a renderer crash (to test recreation). */
  crash(): void
}

/**
 * Owns one offscreen output window and its frame repeater. The window cannot
 * be closed by the user, is recreated when its renderer dies, and is destroyed
 * only through `shutdown()` (app quit, or NdiPipeline replacing it with a
 * window of another size).
 */
export class Output {
  private win: BrowserWindow | null = null
  private repeater: FrameRepeater
  private quitting = false
  private last: Buffer | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private dumpSeq = 0
  /** The renderer said it is ready; the next paint is its first real frame. */
  private awaitingReadyPaint = false
  private readyRepaint: ReturnType<typeof setTimeout> | null = null
  readonly debug: OutputDebug

  /**
   * @param onReady called on the first paint after the window's renderer sent
   *   `output:ready` (current program state decoded and committed), i.e. the
   *   first frame that shows real content rather than the black placeholder.
   *   Called again for a window recreated after a crash or scale change.
   */
  constructor(
    private opts: OutputOptions,
    send: (frame: Buffer) => void,
    private dumpDir?: string,
    private onReady: () => void = () => {}
  ) {
    const counted = (frame: Buffer): void => {
      this.debug.sent++
      send(frame)
    }
    this.repeater = new FrameRepeater(counted, opts.fps)
    this.debug = {
      options: { ...opts },
      paints: 0,
      sent: 0,
      lastLength: 0,
      restarts: 0,
      readies: 0,
      paint: {
        scaleFactor: 1,
        windowDip: { width: 0, height: 0 },
        painted: null,
        mode: null,
        count: 0,
        totalMs: 0,
        maxMs: 0
      },
      dump: () => this.dump(),
      pixel: (x, y) => {
        if (!this.last) return null
        const i = (y * this.opts.width + x) * 4
        return [...this.last.subarray(i, i + 4)]
      },
      crash: () => this.win?.webContents.forcefullyCrashRenderer()
    }
    // The window's DIP size depends on the display scale factor (see
    // output-window.ts). If the user changes Windows scaling while the app
    // runs, rebuild the window at the new size; meanwhile the repeater keeps
    // sending the last frame.
    screen.on('display-metrics-changed', this.onMetrics)
  }

  private onMetrics = (_e: unknown, _display: unknown, changed: string[]): void => {
    if (!changed.includes('scaleFactor') || !this.win || this.win.isDestroyed()) return
    if (screen.getPrimaryDisplay().scaleFactor === this.debug.paint.scaleFactor) return
    console.log('[output] skala layar berubah; jendela output dibuat ulang')
    this.replace(this.win)
  }

  start(): void {
    if (this.quitting || (this.win && !this.win.isDestroyed())) return
    const win = createOutputWindow(
      this.opts,
      (frame) => {
        this.debug.paints++
        this.debug.lastLength = frame.length
        this.last = frame
        this.repeater.push(frame)
        if (this.awaitingReadyPaint && this.win === win) {
          this.awaitingReadyPaint = false
          this.clearReadyRepaint()
          this.debug.readies++
          this.onReady()
        }
      },
      this.debug.paint
    )
    // Only this window's own renderer can make it ready: webContents.ipc only
    // receives messages sent by this webContents (the operator window's
    // window.api.outputReady() never arrives here).
    win.webContents.ipc.on(Send.outputReady, () => {
      if (this.win !== win || win.isDestroyed()) return
      this.awaitingReadyPaint = true
      // The frame with the committed content may still be on its way from the
      // GPU (offscreen paints lag the renderer by a few frames), so the next
      // natural paint is awaited; invalidate() right now would repaint the
      // stale frame the browser already holds. If that frame had already
      // arrived before this message, no paint follows: force one later.
      this.clearReadyRepaint()
      this.readyRepaint = setTimeout(() => {
        this.readyRepaint = null
        if (this.awaitingReadyPaint && this.win === win && !win.isDestroyed()) {
          win.webContents.invalidate()
        }
      }, READY_REPAINT_MS)
    })
    win.on('close', (e) => {
      if (!this.quitting) e.preventDefault()
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[output] renderer berhenti (${details.reason}); dibuat ulang`)
      // The repeater keeps sending the last frame until the new window paints.
      this.scheduleRestart(win)
    })
    this.win = win
  }

  shutdown(): void {
    this.quitting = true
    screen.removeListener('display-metrics-changed', this.onMetrics)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.clearReadyRepaint()
    this.repeater.stop()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private clearReadyRepaint(): void {
    if (this.readyRepaint) clearTimeout(this.readyRepaint)
    this.readyRepaint = null
  }

  private scheduleRestart(dead: BrowserWindow): void {
    if (this.quitting || this.restartTimer) return
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.replace(dead)
    }, RESTART_DELAY_MS)
  }

  /** Destroys `old` (if still current) and creates a fresh output window. */
  private replace(old: BrowserWindow): void {
    if (this.quitting) return
    if (!old.isDestroyed()) old.destroy()
    if (this.win === old) this.win = null
    this.awaitingReadyPaint = false
    this.clearReadyRepaint()
    this.debug.restarts++
    this.start()
  }

  private dump(): string | null {
    if (!this.dumpDir || !this.last) return null
    const { width, height } = this.opts
    const img = nativeImage.createFromBitmap(this.last, { width, height })
    fs.mkdirSync(this.dumpDir, { recursive: true })
    const file = join(this.dumpDir, `output-${++this.dumpSeq}.png`)
    fs.writeFileSync(file, img.toPNG())
    return file
  }
}
