import { restartAllowed, type OmtSettings, type OmtStatus } from '../../shared/omt'

/** Electron-free OMT output logic; the Electron window and worker are injected (see ../omt-output.ts). */

export const RESTART_DELAY_MS = 1000
export const STOP_WAIT_MS = 1500
const CREATE_FAILED =
  'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'

/** The slice of worker_threads.Worker that OmtController uses. */
export interface WorkerLike {
  postMessage(m: unknown, transfer?: ArrayBuffer[]): void
  on(ev: 'message' | 'error' | 'exit', fn: (a?: unknown) => void): unknown
  terminate(): Promise<number> | void
}

export interface WindowHandlers {
  onPaint(width: number, height: number, data: ArrayBuffer): void
  /** `output:ready` from this window's own renderer. */
  onReady(): void
  /** The renderer process stopped. */
  onGone(): void
  /** One block of 48 kHz planar stereo (left samples, then right samples). */
  onAudio(data: Float32Array, samples: number): void
}

export interface OmtWindowLike {
  resize(width: number, height: number): void
  setFrameRate(fps: number): void
  /** Forces a new paint (offscreen only paints on change). */
  invalidate(): void
  destroy(): void
}

export interface OmtDeps {
  createWorker(): WorkerLike
  createWindow(
    h: WindowHandlers,
    size: { width: number; height: number },
    fps: number
  ): OmtWindowLike
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(t: unknown): void
  now(): number
  restartDelayMs: number
  stopWaitMs: number
}

export interface OmtDebug {
  status: OmtStatus
  windowExists: boolean
  ready: boolean
  sending: boolean
  workerStarts: number
  windowCreates: number
  /** Frames the (fake) binding received, from the worker's debug reply. Null outside PPT_OUTPUT_DUMP. */
  frames: { count: number; sizes: string[] } | null
}

type Size = { width: number; height: number }
type WorkerMsg =
  | { type: 'status'; id: string; status: Partial<OmtStatus> }
  | { type: 'stopped' }
  | { type: 'debug'; count: number; sizes: string[] }

const OFF: OmtStatus = { state: 'off', connections: 0, address: null }

/**
 * Owns the OMT worker and the offscreen window and keeps them following the
 * settings and the Canvas. Rules:
 * - one worker while enabled; the sender inside it is restarted (stop, wait
 *   RESTART_DELAY_MS, start) on name/fps/canvas changes;
 * - black frames until THIS window sent output:ready; a crashed renderer never
 *   produces black (the worker repeats its last good frame);
 * - 3 worker failures within a minute: status error until turned off and on;
 * - the worker is only terminated after it answered `stopped` (or a timeout).
 */
export class OmtController {
  private worker: WorkerLike | null = null
  private win: OmtWindowLike | null = null
  private winSeq = 0
  private ready = false
  private sending = false
  private active = false
  private gaveUp = false
  private quitting = false
  private failures: number[] = []
  private st: OmtStatus = OFF
  private winSize: Size = { width: 0, height: 0 }
  private startTimer: unknown = null
  private winTimer: unknown = null
  private stopWaiters = new Map<WorkerLike, () => void>()
  private retired = new Set<WorkerLike>()
  private workerStarts = 0
  private windowCreates = 0
  private dbg: OmtDebug['frames'] = null
  private debugPoll: unknown = null

  constructor(
    private cfg: OmtSettings,
    private canvas: () => Size,
    private onStatus: (s: OmtStatus) => void,
    private deps: OmtDeps,
    private debugEnabled = false
  ) {}

  /** Starts the output when it is enabled in the saved settings. */
  start(): void {
    if (this.cfg.enabled && !this.active && !this.quitting) this.enable()
  }

  apply(next: OmtSettings): void {
    const prev = this.cfg
    this.cfg = { ...next }
    if (this.quitting) return
    if (!next.enabled) {
      if (this.active) this.disable()
      return
    }
    if (!this.active) {
      this.enable()
      return
    }
    if (this.gaveUp) return
    if (prev.fps !== next.fps) this.win?.setFrameRate(next.fps)
    if (prev.name !== next.name || prev.fps !== next.fps) this.restartSender()
  }

  /** The Canvas may have changed: resize the window and rebuild the sender when the size differs. */
  canvasChanged(): void {
    if (!this.active || this.gaveUp || this.quitting) return
    const c = this.canvas()
    if (c.width === this.winSize.width && c.height === this.winSize.height) return
    this.winSize = { width: c.width, height: c.height }
    this.win?.resize(c.width, c.height)
    this.restartSender()
  }

  status(): OmtStatus {
    return this.st
  }

  get debug(): OmtDebug {
    return {
      status: this.st,
      windowExists: !!this.win,
      ready: this.ready,
      sending: this.sending,
      workerStarts: this.workerStarts,
      windowCreates: this.windowCreates,
      frames: this.dbg
    }
  }

  /** Quit: stop the sender, wait for the worker's `stopped`, then terminate it. */
  async shutdown(): Promise<void> {
    this.quitting = true
    this.active = false
    this.clearTimers()
    this.destroyWindow()
    const w = this.worker
    this.worker = null
    this.sending = false
    if (w) await this.retire(w)
    this.setStatus(OFF)
  }

  // ---- lifecycle ----

  private enable(): void {
    this.active = true
    this.gaveUp = false
    this.failures = []
    this.setStatus({ state: 'starting', connections: 0, address: null })
    this.winSize = { ...this.canvas() }
    if (!this.spawnWorker()) return
    this.createWindow()
    this.beginSender()
  }

  private disable(): void {
    this.active = false
    this.gaveUp = false
    this.clearTimers()
    this.destroyWindow()
    const w = this.worker
    this.worker = null
    this.sending = false
    if (w) void this.retire(w)
    this.setStatus(OFF)
  }

  private spawnWorker(): boolean {
    let w: WorkerLike
    try {
      w = this.deps.createWorker()
    } catch (e) {
      console.error('[omt] worker could not be created:', e)
      this.gaveUp = true
      this.setStatus({ state: 'error', connections: 0, address: null, message: CREATE_FAILED })
      return false
    }
    this.worker = w
    this.workerStarts++
    w.on('message', (m) => this.onWorkerMessage(w, m as WorkerMsg))
    w.on('error', (e) => {
      console.error('[omt] worker error:', e)
      this.onWorkerDown(w)
    })
    w.on('exit', () => this.onWorkerDown(w))
    if (this.debugEnabled && this.debugPoll === null) {
      this.debugPoll = this.deps.setTimer(() => this.pollDebug(), 500)
    }
    return true
  }

  private pollDebug(): void {
    this.debugPoll = null
    if (this.quitting || !this.active) return
    this.worker?.postMessage({ type: 'debugGet' })
    this.debugPoll = this.deps.setTimer(() => this.pollDebug(), 500)
  }

  private createWindow(): void {
    if (this.win || this.quitting || !this.active) return
    const id = ++this.winSeq
    const mine = (): boolean => id === this.winSeq
    this.ready = false
    this.windowCreates++
    this.win = this.deps.createWindow(
      {
        onPaint: (width, height, data) => {
          if (!mine() || !this.ready || !this.sending || !this.worker) return
          this.worker.postMessage({ type: 'frame', width, height, data }, [data])
        },
        onReady: () => {
          if (!mine()) return
          this.ready = true
          this.win?.invalidate()
        },
        onGone: () => {
          if (!mine()) return
          console.error('[omt] output renderer stopped; recreating it')
          this.destroyWindow()
          this.winTimer = this.deps.setTimer(() => {
            this.winTimer = null
            this.createWindow()
          }, this.deps.restartDelayMs)
        },
        onAudio: (data, samples) => {
          if (!mine() || !this.sending || !this.worker) return
          if (!(data instanceof Float32Array) || !Number.isInteger(samples)) return
          if (samples <= 0 || data.length !== samples * 2) return
          this.worker.postMessage({ type: 'audio', data, samples }, [data.buffer as ArrayBuffer])
        }
      },
      this.winSize,
      this.cfg.fps
    )
  }

  private destroyWindow(): void {
    const w = this.win
    this.win = null
    this.winSeq++
    this.ready = false
    if (this.winTimer !== null) this.deps.clearTimer(this.winTimer)
    this.winTimer = null
    try {
      w?.destroy()
    } catch {
      // already gone
    }
  }

  /** Tells the worker to start the sender at the current Canvas size. */
  private beginSender(): void {
    const w = this.worker
    if (!w) return
    const { width, height } = this.winSize
    w.postMessage({
      type: 'start',
      targets: [{ id: 'omt', name: this.cfg.name }],
      fps: this.cfg.fps,
      width,
      height
    })
    this.sending = true
    if (this.ready) {
      // A new clock has no frame yet; ask the renderer for one.
      this.win?.invalidate()
    } else {
      const data = new ArrayBuffer(width * height * 4)
      const px = new Uint8Array(data)
      for (let i = 3; i < px.length; i += 4) px[i] = 255
      w.postMessage({ type: 'frame', width, height, data }, [data])
    }
  }

  /** stop, wait, start: back-to-back same-name restarts can be undiscoverable for ~20 s. */
  private restartSender(): void {
    if (!this.worker || this.gaveUp) return
    if (this.startTimer !== null) this.deps.clearTimer(this.startTimer)
    if (this.sending) {
      this.worker.postMessage({ type: 'stop' })
      this.sending = false
    }
    this.setStatus({ state: 'starting', connections: 0, address: null })
    this.startTimer = this.deps.setTimer(() => {
      this.startTimer = null
      if (this.quitting || !this.active || !this.worker) return
      this.beginSender()
    }, this.deps.restartDelayMs)
  }

  private onWorkerDown(w: WorkerLike): void {
    if (this.retired.has(w) || w !== this.worker) return
    this.worker = null
    this.sending = false
    try {
      void w.terminate()
    } catch {
      // already dead
    }
    if (this.startTimer !== null) this.deps.clearTimer(this.startTimer)
    this.startTimer = null
    if (!this.active || this.quitting) return
    const now = this.deps.now()
    this.failures.push(now)
    if (!restartAllowed(this.failures, now)) {
      this.gaveUp = true
      this.setStatus({ state: 'error', connections: 0, address: null, message: CREATE_FAILED })
      return
    }
    this.setStatus({ state: 'starting', connections: 0, address: null })
    this.startTimer = this.deps.setTimer(() => {
      this.startTimer = null
      if (this.quitting || !this.active) return
      if (this.spawnWorker()) this.beginSender()
    }, this.deps.restartDelayMs)
  }

  private onWorkerMessage(w: WorkerLike, m: WorkerMsg): void {
    if (m.type === 'stopped') {
      this.stopWaiters.get(w)?.()
      return
    }
    if (w !== this.worker) return
    if (m.type === 'debug') {
      this.dbg = { count: m.count, sizes: m.sizes }
      return
    }
    if (m.type !== 'status' || m.id !== 'omt') return
    const p = m.status
    // The sender reports `off` on every internal stop; while enabled that is a restart, shown as starting.
    if (p.state === 'off' && this.active) return
    const next: OmtStatus = { ...this.st, ...p }
    if ('warning' in p && p.warning === undefined) delete next.warning
    this.setStatus(next)
  }

  /** Sends stop, waits for `stopped` (or the timeout), then terminates. Never terminates while sending. */
  private async retire(w: WorkerLike): Promise<void> {
    this.retired.add(w)
    await new Promise<void>((resolve) => {
      let timer: unknown = null
      const done = (): void => {
        if (timer !== null) this.deps.clearTimer(timer)
        this.stopWaiters.delete(w)
        resolve()
      }
      this.stopWaiters.set(w, done)
      timer = this.deps.setTimer(done, this.deps.stopWaitMs)
      try {
        w.postMessage({ type: 'stop' })
      } catch {
        done()
      }
    })
    try {
      await w.terminate()
    } catch {
      // already gone
    }
  }

  private clearTimers(): void {
    for (const t of [this.startTimer, this.debugPoll]) if (t !== null) this.deps.clearTimer(t)
    this.startTimer = null
    this.debugPoll = null
  }

  private setStatus(s: OmtStatus): void {
    if (JSON.stringify(s) === JSON.stringify(this.st)) return
    this.st = s
    this.onStatus(s)
  }
}
