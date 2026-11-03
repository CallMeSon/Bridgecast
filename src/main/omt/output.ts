import type { FakeDebug } from './worker'
import type { ContentRect } from '../../shared/canvas'
import { cropBgra } from './crop'
import {
  NDI_COPY,
  networkOn,
  restartAllowed,
  type NdiSettings,
  type NetStatus,
  type OmtSettings
} from '../../shared/omt'

/** Electron-free network (OMT and NDI) output logic; the Electron window and worker are injected (see ../net-output.ts). */

export const RESTART_DELAY_MS = 1000
export const STOP_WAIT_MS = 1500
const CREATE_FAILED =
  'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'

export type NetId = 'omt' | 'ndi'
export interface NetSettings {
  omt: OmtSettings
  ndi: NdiSettings
}
const IDS: readonly NetId[] = ['omt', 'ndi']
const failedCopy = (id: NetId): string => (id === 'ndi' ? NDI_COPY.createFailed : CREATE_FAILED)

/** The slice of worker_threads.Worker that NetController uses. */
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
  /** A warning the renderer reports (untrusted payload): only 'no-sound' is accepted. */
  onWarning(w: unknown): void
}

export interface OmtWindowLike {
  resize(width: number, height: number): void
  setFrameRate(fps: number): void
  /** Forces a new paint (offscreen only paints on change). */
  invalidate(): void
  destroy(): void
  /** id of the window's webContents (tells its IPC calls apart); absent in fakes. */
  readonly webContentsId?: number
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
  status: NetStatus
  ndiStatus: NetStatus
  windowExists: boolean
  ready: boolean
  sending: boolean
  workerStarts: number
  windowCreates: number
  /** Frames the (fake) binding received, from the worker's debug reply. Null outside PPT_OUTPUT_DUMP. */
  frames: ({ count: number; sizes: string[] } & Partial<FakeDebug>) | null
  workerAlive: boolean
}

type Size = { width: number; height: number }

/** A rectangle lies whole inside a `c`-sized picture, with whole-pixel sides and origin. */
function inside(r: ContentRect, c: Size): boolean {
  return (
    Number.isInteger(r.x) &&
    Number.isInteger(r.y) &&
    Number.isInteger(r.width) &&
    Number.isInteger(r.height) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= c.width &&
    r.y + r.height <= c.height
  )
}

type WorkerMsg =
  | { type: 'status'; id: string; status: Partial<NetStatus> }
  | { type: 'stopped' }
  | { type: 'debug'; count: number; sizes: string[]; extra?: FakeDebug }

const OFF: NetStatus = { state: 'off', connections: 0, address: null }
const STARTING: NetStatus = { state: 'starting', connections: 0, address: null }

/**
 * Owns the network worker and the one offscreen window and keeps them following
 * the OMT and NDI settings and the Canvas. Rules:
 * - one window and one worker while any target is enabled; the worker's sender
 *   gets a target list, so switching NDI on or off never touches OMT's frames;
 * - a name change restarts only that target (removed, RESTART_DELAY_MS, added);
 *   an fps or Canvas change restarts the whole sender once (stop, wait, start);
 * - the sender sends the content rect (the whole Canvas, or the slide without Fit
 *   bars): frames are cut from the window's picture, the window stays Canvas-sized,
 *   and a change of the rect's size rebuilds the sender like a Canvas change;
 * - black frames until THIS window sent output:ready; a crashed renderer never
 *   produces black (the worker repeats its last good frame);
 * - 3 worker failures within a minute: status error until turned off and on;
 * - the worker is only terminated after it answered `stopped` (or a timeout).
 */
export class NetController {
  private worker: WorkerLike | null = null
  private win: OmtWindowLike | null = null
  private winSeq = 0
  private ready = false
  private sending = false
  private active = false
  private gaveUp = false
  private quitting = false
  private failures: number[] = []
  private st: Record<NetId, NetStatus> = { omt: OFF, ndi: OFF }
  /** Targets (id and name) the worker's sender currently has. */
  private cur = new Map<NetId, string>()
  /** Targets taken out for a name change, with the timer that adds them back. */
  private waiting = new Map<NetId, unknown>()
  /**
   * The window's sound tap failed to load. Sticky while that window lives (the
   * renderer reports it once and never retries), so every status emission
   * carries it. Precedence: 'no-sound' wins over the sender's 'drops' and
   * 'no-receivers', because it needs the operator to act while those pass.
   * Cleared when the window is destroyed (turned off, renderer restarted).
   */
  private soundLost = false
  private winSize: Size = { width: 0, height: 0 }
  /** The part of the window's picture the sender sends; its size is the sender's frame size. */
  private rect: ContentRect = { x: 0, y: 0, width: 0, height: 0 }
  /** This window has posted a frame since enable(); after that no black frame is sent (see kick). */
  private painted = false
  private startTimer: unknown = null
  private winTimer: unknown = null
  private stopWaiters = new Map<WorkerLike, () => void>()
  private retired = new Set<WorkerLike>()
  private workerStarts = 0
  private windowCreates = 0
  private dbg: OmtDebug['frames'] = null
  private debugPoll: unknown = null

  /**
   * `sendRect` gives the part of the Canvas to send, re-read on every program change;
   * absent or outside the Canvas means the whole Canvas.
   */
  constructor(
    private cfg: NetSettings,
    private canvas: () => Size,
    private onStatus: (id: NetId, s: NetStatus) => void,
    private deps: OmtDeps,
    private debugEnabled = false,
    private sendRect: (() => ContentRect) | null = null
  ) {}

  /** Starts the output when a target is enabled in the saved settings. */
  start(): void {
    if (networkOn(this.cfg) && !this.active && !this.quitting) this.enable()
  }

  apply(next: NetSettings): void {
    const prev = this.cfg
    this.cfg = { omt: { ...next.omt }, ndi: { ...next.ndi } }
    if (this.quitting) return
    if (!networkOn(next)) {
      if (this.active) this.disable()
      return
    }
    if (!this.active) {
      this.enable()
      return
    }
    let switchedOn = false
    for (const id of IDS) {
      if (!next[id].enabled) {
        this.setStatus(id, OFF)
        this.cancelWait(id)
      } else if (!prev[id].enabled) {
        this.setStatus(id, STARTING)
        switchedOn = true
      }
    }
    if (this.gaveUp) {
      // After give-up, switching a protocol on is the operator's retry: start fresh.
      if (switchedOn) {
        this.disable()
        this.enable()
      }
      return
    }
    if (prev.omt.fps !== next.omt.fps) {
      this.win?.setFrameRate(next.omt.fps)
      this.restartSender()
      return
    }
    this.syncTargets()
  }

  /** The Canvas may have changed: resize the window and rebuild the sender when the size differs. */
  canvasChanged(): void {
    if (!this.active || this.gaveUp || this.quitting) return
    const c = this.canvas()
    const sized = c.width !== this.winSize.width || c.height !== this.winSize.height
    if (sized) {
      this.winSize = { width: c.width, height: c.height }
      this.win?.resize(c.width, c.height)
    }
    // The content rect lies inside the Canvas, so it follows a Canvas change too.
    const resized = this.syncRect()
    if (sized || resized) this.restartSender()
  }

  /**
   * What is on air may have changed (a Fit slide, KV, Black, a web page...): re-read the
   * content rect. Only a change of its size rebuilds the sender; the window is not resized.
   */
  contentChanged(): void {
    if (!this.active || this.gaveUp || this.quitting) return
    if (this.syncRect()) this.restartSender()
  }

  /**
   * Re-reads the rect to send: the injected one when it lies inside the Canvas, else the
   * whole Canvas (winSize). Returns true when its size changed.
   */
  private syncRect(): boolean {
    const whole: ContentRect = {
      x: 0,
      y: 0,
      width: this.winSize.width,
      height: this.winSize.height
    }
    const want = this.sendRect?.()
    const next = want && inside(want, whole) ? { ...want } : whole
    const prev = this.rect
    this.rect = next
    return prev.width !== next.width || prev.height !== next.height
  }

  status(id: NetId): NetStatus {
    return this.st[id]
  }

  /** True when `webContentsId` is the network output window (there is one while a target is on). */
  ownsWebContents(webContentsId: number): boolean {
    return this.win?.webContentsId === webContentsId
  }

  /** The network output window exists, so it shows the program. */
  get windowActive(): boolean {
    return this.win !== null
  }

  get debug(): OmtDebug {
    return {
      status: this.st.omt,
      ndiStatus: this.st.ndi,
      windowExists: !!this.win,
      ready: this.ready,
      sending: this.sending,
      workerStarts: this.workerStarts,
      windowCreates: this.windowCreates,
      frames: this.dbg,
      workerAlive: this.worker !== null
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
    this.cur.clear()
    if (w) await this.retire(w)
    for (const id of IDS) this.setStatus(id, OFF)
  }

  // ---- lifecycle ----

  private enable(): void {
    this.active = true
    this.gaveUp = false
    this.failures = []
    for (const id of IDS) this.setStatus(id, this.cfg[id].enabled ? STARTING : OFF)
    this.winSize = { ...this.canvas() }
    this.syncRect()
    this.painted = false
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
    this.cur.clear()
    if (w) void this.retire(w)
    for (const id of IDS) this.setStatus(id, OFF)
  }

  private enabledIds(): NetId[] {
    return IDS.filter((id) => this.cfg[id].enabled)
  }

  private errorAll(): void {
    for (const id of IDS) {
      if (this.cfg[id].enabled)
        this.setStatus(id, {
          state: 'error',
          connections: 0,
          address: null,
          message: failedCopy(id)
        })
    }
  }

  private spawnWorker(): boolean {
    let w: WorkerLike
    try {
      w = this.deps.createWorker()
    } catch (e) {
      console.error('[net] worker could not be created:', e)
      this.gaveUp = true
      this.errorAll()
      return false
    }
    this.worker = w
    this.workerStarts++
    w.on('message', (m) => this.onWorkerMessage(w, m as WorkerMsg))
    w.on('error', (e) => {
      console.error('[net] worker error:', e)
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
          // A clamped or scaled frame would break the sender's fixed size.
          if (data.byteLength !== width * height * 4) return
          if (width !== this.winSize.width || height !== this.winSize.height) return
          const r = this.rect
          if (!inside(r, { width, height })) return
          this.painted = true
          if (r.x === 0 && r.y === 0 && r.width === width && r.height === height) {
            this.worker.postMessage({ type: 'frame', width, height, data }, [data])
            return
          }
          // Only the slide: cut it out of the Canvas picture; the sender is built for this size.
          const cut = cropBgra(data, width, r)
          this.worker.postMessage({ type: 'frame', width: r.width, height: r.height, data: cut }, [
            cut
          ])
        },
        onReady: () => {
          if (!mine()) return
          this.ready = true
          this.win?.invalidate()
        },
        onGone: () => {
          if (!mine()) return
          console.error('[net] output renderer stopped; recreating it')
          this.destroyWindow()
          this.winTimer = this.deps.setTimer(() => {
            this.winTimer = null
            this.createWindow()
          }, this.deps.restartDelayMs)
        },
        onWarning: (w) => {
          if (!mine() || w !== 'no-sound' || !this.active) return
          this.soundLost = true
          for (const i of IDS) this.setStatus(i, this.st[i])
        },
        onAudio: (data, samples) => {
          if (!mine() || !this.sending || !this.worker) return
          if (!(data instanceof Float32Array) || !Number.isInteger(samples)) return
          if (samples <= 0 || data.length !== samples * 2) return
          this.worker.postMessage({ type: 'audio', data, samples }, [data.buffer as ArrayBuffer])
        }
      },
      this.winSize,
      this.cfg.omt.fps
    )
  }

  private destroyWindow(): void {
    const w = this.win
    this.win = null
    this.winSeq++
    this.ready = false
    if (this.soundLost) {
      this.soundLost = false
      for (const id of IDS) {
        if (this.st[id].warning === 'no-sound') {
          const rest = { ...this.st[id] }
          delete rest.warning
          this.setStatus(id, rest)
        }
      }
    }
    if (this.winTimer !== null) this.deps.clearTimer(this.winTimer)
    this.winTimer = null
    try {
      w?.destroy()
    } catch {
      // already gone
    }
  }

  /** The targets the settings ask for. */
  private wanted(): { id: NetId; name: string }[] {
    return this.enabledIds().map((id) => ({ id, name: this.cfg[id].name }))
  }

  /**
   * A new clock has no frame yet; get one (the renderer's, or black until it is ready).
   * After this window's first frame, a rebuild never sends black: it waits for the next real one.
   */
  private kick(): void {
    if (this.ready) {
      this.win?.invalidate()
      return
    }
    if (this.painted) return
    const { width, height } = this.rect
    const data = new ArrayBuffer(width * height * 4)
    const px = new Uint8Array(data)
    for (let i = 3; i < px.length; i += 4) px[i] = 255
    this.worker?.postMessage({ type: 'frame', width, height, data }, [data])
  }

  /** Tells the worker to start the sender at the current Canvas size with every enabled target. */
  private beginSender(): void {
    const w = this.worker
    if (!w) return
    const { width, height } = this.rect
    const targets = this.wanted()
    this.cancelAllWaits()
    this.cur = new Map(targets.map((t) => [t.id, t.name]))
    w.postMessage({ type: 'start', targets, fps: this.cfg.omt.fps, width, height })
    this.sending = true
    this.kick()
  }

  /**
   * Makes the worker's target list follow the settings without touching targets
   * that did not change (their frame clock keeps running). A renamed target is
   * taken out now and added back after RESTART_DELAY_MS.
   */
  private syncTargets(): void {
    if (!this.worker || !this.sending || this.gaveUp) return
    const list: { id: NetId; name: string }[] = []
    for (const t of this.wanted()) {
      if (this.waiting.has(t.id)) continue
      const had = this.cur.get(t.id)
      if (had !== undefined && had !== t.name) {
        this.setStatus(t.id, STARTING)
        this.waiting.set(
          t.id,
          this.deps.setTimer(() => {
            this.waiting.delete(t.id)
            this.syncTargets()
          }, this.deps.restartDelayMs)
        )
        continue
      }
      list.push(t)
    }
    const same = list.length === this.cur.size && list.every((t) => this.cur.get(t.id) === t.name)
    if (same) return
    const wasEmpty = this.cur.size === 0
    this.cur = new Map(list.map((t) => [t.id, t.name]))
    this.worker.postMessage({ type: 'targets', targets: list })
    if (wasEmpty && list.length > 0) this.kick()
  }

  private cancelWait(id: NetId): void {
    const t = this.waiting.get(id)
    if (t !== undefined) this.deps.clearTimer(t)
    this.waiting.delete(id)
  }

  private cancelAllWaits(): void {
    for (const id of [...this.waiting.keys()]) this.cancelWait(id)
  }

  /** stop, wait, start: back-to-back same-name restarts can be undiscoverable for ~20 s. */
  private restartSender(): void {
    if (!this.worker || this.gaveUp) return
    if (this.startTimer !== null) this.deps.clearTimer(this.startTimer)
    this.cancelAllWaits()
    if (this.sending) {
      this.worker.postMessage({ type: 'stop' })
      this.sending = false
    }
    this.cur.clear()
    for (const id of IDS) this.setStatus(id, this.cfg[id].enabled ? STARTING : OFF)
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
    this.cur.clear()
    this.cancelAllWaits()
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
      this.errorAll()
      return
    }
    for (const id of this.enabledIds()) this.setStatus(id, STARTING)
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
      this.dbg = { count: m.count, sizes: m.sizes, ...m.extra }
      return
    }
    if (m.type !== 'status' || (m.id !== 'omt' && m.id !== 'ndi')) return
    // Reports of a target the sender no longer has are stale (it was just removed or restarted).
    if (!this.cur.has(m.id)) return
    const p = m.status
    // The sender reports `off` on every removal; this controller owns off and starting.
    if (p.state === 'off') return
    const next: NetStatus = { ...this.st[m.id], ...p }
    if ('warning' in p && p.warning === undefined) delete next.warning
    this.setStatus(m.id, next)
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
    // terminate() cannot interrupt a blocked native call, so its wait is bounded too.
    await new Promise<void>((resolve) => {
      const timer = this.deps.setTimer(resolve, this.deps.stopWaitMs)
      const settle = (): void => {
        this.deps.clearTimer(timer)
        resolve()
      }
      try {
        void Promise.resolve(w.terminate()).then(settle, settle)
      } catch {
        settle()
      }
    })
  }

  private clearTimers(): void {
    for (const t of [this.startTimer, this.debugPoll]) if (t !== null) this.deps.clearTimer(t)
    this.startTimer = null
    this.debugPoll = null
    this.cancelAllWaits()
  }

  private setStatus(id: NetId, raw: NetStatus): void {
    const s: NetStatus =
      this.soundLost && raw.state !== 'off' ? { ...raw, warning: 'no-sound' } : raw
    if (JSON.stringify(s) === JSON.stringify(this.st[id])) return
    this.st[id] = s
    this.onStatus(id, s)
  }
}
