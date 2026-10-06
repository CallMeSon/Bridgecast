import { nativeImage, screen, type BrowserWindow } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { FrameRepeater } from './frame-repeater'
import { createOutputWindow, type OutputOptions, type PaintStats } from './output-window'

const RESTART_DELAY_MS = 1000

/** Counters and frame dump, only exposed when PPT_OUTPUT_DUMP is set (dev/e2e). */
export interface OutputDebug {
  paints: number
  sent: number
  lastLength: number
  restarts: number
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
 * Owns the single offscreen output window and the frame repeater. The window
 * cannot be closed by the user, is recreated when its renderer dies, and is
 * destroyed only through `shutdown()` when the app quits.
 */
export class Output {
  private win: BrowserWindow | null = null
  private repeater: FrameRepeater
  private quitting = false
  private last: Buffer | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private dumpSeq = 0
  readonly debug: OutputDebug

  constructor(
    private opts: OutputOptions,
    send: (frame: Buffer) => void,
    private dumpDir?: string
  ) {
    const counted = (frame: Buffer): void => {
      this.debug.sent++
      send(frame)
    }
    this.repeater = new FrameRepeater(counted, opts.fps)
    this.debug = {
      paints: 0,
      sent: 0,
      lastLength: 0,
      restarts: 0,
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
    screen.on('display-metrics-changed', (_e, _display, changed) => {
      if (!changed.includes('scaleFactor') || !this.win || this.win.isDestroyed()) return
      if (screen.getPrimaryDisplay().scaleFactor === this.debug.paint.scaleFactor) return
      console.log('[output] skala layar berubah; jendela output dibuat ulang')
      this.replace(this.win)
    })
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
      },
      this.debug.paint
    )
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
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.repeater.stop()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
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
