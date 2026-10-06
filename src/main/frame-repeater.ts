/**
 * Sends the latest frame at a fixed rate. Offscreen windows only emit `paint`
 * when something changes, so a static slide would otherwise produce no frames
 * and NDI receivers would see a dead source. Frames are sent on the clock only
 * (never directly on push) so the output rate stays at `fps`.
 */
export class FrameRepeater {
  private last: Buffer | null = null
  private timer: ReturnType<typeof setInterval> | null

  constructor(
    private send: (frame: Buffer) => void,
    fps: number,
    schedule: typeof setInterval = setInterval
  ) {
    this.timer = schedule(() => this.tick(), 1000 / fps)
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
    if (!this.last) return
    try {
      this.send(this.last)
    } catch (err) {
      console.error('[output] mengirim frame gagal:', err)
    }
  }
}
