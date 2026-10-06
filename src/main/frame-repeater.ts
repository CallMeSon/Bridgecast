/**
 * Sends the latest frame at a fixed rate. Offscreen windows only emit `paint`
 * when something changes, so a static slide would otherwise produce no frames
 * and NDI receivers would see a dead source. Frames are sent on the clock only
 * (never directly on push) so the output rate stays at `fps`.
 *
 * Windows timers fire on a ~15.6 ms grid, so `setInterval(1000 / fps)` alone
 * runs at 21 fps instead of 30. The timer therefore ticks at a quarter period
 * and a frame goes out whenever its deadline has passed: on average exactly
 * `fps` frames per second, with at most one tick of jitter.
 */
export class FrameRepeater {
  private last: Buffer | null = null
  private timer: ReturnType<typeof setInterval> | null
  private readonly period: number
  private due: number

  constructor(
    private send: (frame: Buffer) => void,
    fps: number,
    schedule: typeof setInterval = setInterval
  ) {
    this.period = 1000 / fps
    this.due = Date.now() + this.period
    this.timer = schedule(() => this.tick(), this.period / 4)
  }

  push(frame: Buffer): void {
    if (this.timer) this.last = frame
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.last = null
  }

  private tick(): void {
    const now = Date.now()
    if (now < this.due) return
    this.due += this.period
    // More than a period behind (blocked event loop, sleep): skip, don't burst.
    if (now - this.due > this.period) this.due = now + this.period
    if (!this.last) return
    try {
      this.send(this.last)
    } catch (err) {
      console.error('[output] mengirim frame gagal:', err)
    }
  }
}
