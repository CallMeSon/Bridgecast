/** A planar block as main sends it: `samples` left values, then `samples` right values. */
export interface PcmData {
  data: Float32Array
  samples: number
}

export interface PcmRingOptions {
  /** Frames to collect before playing starts (and starts again after an underrun). */
  prebuffer: number
  /** Most frames kept; older ones are dropped so the delay stays bounded. */
  capacity: number
}

/**
 * A jitter buffer for PowerPoint's sound: blocks arrive from the main process in
 * bursts, the audio thread reads 128 frames at a time. It plays silence until
 * `prebuffer` frames are held, and again after running dry; over `capacity` the oldest
 * frames are dropped. Pure, so the worklet's logic can be unit tested.
 */
export class PcmRing {
  private readonly left: Float32Array
  private readonly right: Float32Array
  private head = 0
  private count = 0
  private playing = false

  constructor(private readonly opts: PcmRingOptions) {
    this.left = new Float32Array(opts.capacity)
    this.right = new Float32Array(opts.capacity)
  }

  /** Frames held now. */
  get buffered(): number {
    return this.count
  }

  write(b: PcmData): void {
    const n = b.samples
    if (!Number.isInteger(n) || n <= 0 || b.data.length !== n * 2) return
    const cap = this.opts.capacity
    // Only the newest `cap` frames of a block that is bigger than the buffer matter.
    const from = Math.max(0, n - cap)
    const keep = n - from
    const over = this.count + keep - cap
    if (over > 0) {
      this.head = (this.head + over) % cap
      this.count -= over
    }
    for (let i = 0; i < keep; i++) {
      const at = (this.head + this.count + i) % cap
      this.left[at] = b.data[from + i]
      this.right[at] = b.data[n + from + i]
    }
    this.count += keep
  }

  /** Fills both outputs (silence when not playing). */
  read(left: Float32Array, right: Float32Array): void {
    const n = left.length
    if (!this.playing && this.count >= this.opts.prebuffer) this.playing = true
    if (!this.playing) {
      left.fill(0)
      right.fill(0)
      return
    }
    const cap = this.opts.capacity
    const take = Math.min(n, this.count)
    for (let i = 0; i < take; i++) {
      const at = (this.head + i) % cap
      left[i] = this.left[at]
      right[i] = this.right[at]
    }
    left.fill(0, take)
    right.fill(0, take)
    this.head = (this.head + take) % cap
    this.count -= take
    if (this.count === 0) this.playing = false
  }
}
