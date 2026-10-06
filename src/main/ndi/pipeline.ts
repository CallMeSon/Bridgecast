import type { OutputOptions } from '../output-window'
import type { NdiSettings } from '../../shared/settings'
import type { NdiFormat, NdiSender } from './sender'

/** What the pipeline needs from an output window (the Output class). */
export interface OutputHandle {
  start(): void
  shutdown(): void
}

/**
 * Creates an output rendering at `opts`. It calls `send` at opts.fps with BGRA
 * frames, and `ready` on its first paint that shows the current program state
 * (not the black placeholder of a freshly loaded window).
 */
export type OutputFactory<T extends OutputHandle> = (
  opts: OutputOptions,
  send: (frame: Buffer) => void,
  ready: () => void
) => T

/** How long a new output may take to become ready before the change is abandoned. */
export const SWAP_TIMEOUT_MS = 10_000

/** Indonesian error (with the fix) when a new output never became ready. */
export const swapTimeoutMessage = (next: OutputOptions, kept: OutputOptions): string =>
  `Output ${next.width}×${next.height} ${next.fps} fps tidak siap dalam ${SWAP_TIMEOUT_MS / 1000} detik; ` +
  `NDI tetap mengirim ${kept.width}×${kept.height} ${kept.fps} fps. ` +
  'Klik Coba lagi, atau pilih resolusi/frame rate lain lalu Terapkan.'

interface Slot<T> {
  out: T
  opts: OutputOptions
}

const geometry = (s: NdiSettings): OutputOptions => ({
  width: s.width,
  height: s.height,
  fps: s.fps
})
const sameGeometry = (a: OutputOptions, b: OutputOptions): boolean =>
  a.width === b.width && a.height === b.height && a.fps === b.fps
const format = (s: NdiSettings): NdiFormat => ({ name: s.name, ...geometry(s) })

/**
 * Wires settings → offscreen output window (+ its FrameRepeater) → NdiSender.
 *
 * - Disabled: no output window, sender stopped.
 * - Name change: only the sender restarts; the window keeps running.
 * - Resolution/fps change: a new window is built at the new size *beside* the
 *   old one. The old window keeps feeding the sender until the new one is
 *   *ready* (its first paint of the current program state, never the black
 *   placeholder); then the sender switches to the new format and the old
 *   window is closed. The NDI source never goes dark or blank.
 * - If the new window is not ready within SWAP_TIMEOUT_MS, it is dropped, the
 *   old window keeps sending, and `onError` reports it. Applying again retries.
 */
export class NdiPipeline<T extends OutputHandle> {
  private active: Slot<T> | null = null
  private pending: Slot<T> | null = null
  private swapTimer: ReturnType<typeof setTimeout> | null = null
  private settings: NdiSettings | null = null

  constructor(
    private sender: NdiSender,
    private createOutput: OutputFactory<T>,
    private onError: (message: string) => void = () => {},
    private swapTimeoutMs = SWAP_TIMEOUT_MS
  ) {}

  /** The output currently feeding NDI (null while disabled). */
  get current(): T | null {
    return this.active?.out ?? null
  }

  apply(next: NdiSettings): void {
    this.settings = { ...next }

    if (!next.enabled) {
      this.dropPending()
      this.closeActive()
      this.sender.stop()
      return
    }
    const geo = geometry(next)
    if (!this.active) {
      this.active = this.build(geo)
      this.sender.start(format(next))
      return
    }
    if (this.pending && sameGeometry(this.pending.opts, geo)) return // swap uses the new name
    if (!this.pending && sameGeometry(this.active.opts, geo)) {
      // Same size: only the sender (re)starts — a name change, or a retry
      // after an error. With an unchanged name the sender keeps its source.
      this.sender.start(format(next))
      return
    }
    this.dropPending()
    if (sameGeometry(this.active.opts, geo)) {
      // Changed back to the size the active window already has.
      this.sender.start(format(next))
      return
    }
    this.pending = this.build(geo)
    this.swapTimer = setTimeout(() => this.abandonPending(), this.swapTimeoutMs)
  }

  shutdown(): void {
    this.dropPending()
    this.closeActive()
    this.sender.stop()
    this.settings = null
  }

  private build(opts: OutputOptions): Slot<T> {
    const slot = {} as Slot<T>
    slot.opts = opts
    slot.out = this.createOutput(
      opts,
      (frame) => this.onFrame(slot, frame),
      () => this.onReady(slot)
    )
    slot.out.start()
    return slot
  }

  private onFrame(slot: Slot<T>, frame: Buffer): void {
    // A pending window's frames never reach NDI: until it is ready they are
    // the black placeholder of a page that is still loading.
    if (slot === this.active) this.sender.sendBgra(frame)
  }

  private onReady(slot: Slot<T>): void {
    if (slot === this.pending) this.swap()
  }

  /** The new output never became ready: keep the old one, report it. */
  private abandonPending(): void {
    const next = this.pending
    if (!next || !this.active) return
    this.dropPending()
    this.onError(swapTimeoutMessage(next.opts, this.active.opts))
  }

  private swap(): void {
    const next = this.pending
    if (!next || !this.settings) return
    if (this.swapTimer) clearTimeout(this.swapTimer)
    this.swapTimer = null
    this.pending = null
    const old = this.active
    this.active = next
    this.sender.start(format(this.settings))
    old?.out.shutdown()
  }

  private dropPending(): void {
    if (this.swapTimer) clearTimeout(this.swapTimer)
    this.swapTimer = null
    this.pending?.out.shutdown()
    this.pending = null
  }

  private closeActive(): void {
    this.active?.out.shutdown()
    this.active = null
  }
}
