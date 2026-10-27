export type Frame = { width: number; height: number; data: ArrayBuffer }

type Timers = {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (id: ReturnType<typeof setInterval>) => void
}

/**
 * Sends one frame per tick at a fixed rate. The newest pushed frame wins; with
 * no new frame the last one is sent again (a static slide must keep streaming
 * or receivers time out).
 */
export class FrameClock {
  private slot: Frame | null = null
  private last: Frame | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private sent = 0
  private dropped = 0

  constructor(
    private readonly fps: number,
    private readonly send: (f: Frame) => void,
    private readonly timers: Timers = { setInterval, clearInterval }
  ) {}

  /** Latest-wins: replacing a frame that was never sent counts one drop. */
  push(f: Frame): void {
    if (this.slot) this.dropped++
    this.slot = f
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = this.timers.setInterval(() => this.tick(), 1000 / this.fps)
  }

  stop(): void {
    if (this.timer === null) return
    this.timers.clearInterval(this.timer)
    this.timer = null
  }

  stats(): { sent: number; dropped: number } {
    return { sent: this.sent, dropped: this.dropped }
  }

  private tick(): void {
    const f = this.slot ?? this.last
    this.slot = null
    if (!f) return
    this.last = f
    this.sent++
    this.send(f)
  }
}
