import type { SenderBinding } from './sender-binding'

/** Recording SenderBinding for tests; touches no native library. */
export class FakeSenderBinding implements SenderBinding {
  frames: { width: number; height: number; fps: number }[] = []
  /** Pixels [r,g,b] of the first and the last frame at the corner and the top centre (e2e checks). */
  firstPx: number[][] | null = null
  lastPx: number[][] | null = null
  /** Black frames that came after a non-black one (a crashed renderer must not cause any). */
  blackAfterContent = 0
  private seenContent = false
  audio = 0
  /** Length of the last audio block's data array (2 * samples). */
  lastAudioLen = 0
  destroyed = false
  names: string[] = []
  private next = 1

  constructor(
    private readonly kind: 'omt' | 'ndi',
    private readonly o: { failCreate?: boolean } = {}
  ) {}

  create(name: string): number {
    if (this.o.failCreate) throw new Error('create failed')
    this.names.push(name)
    return this.next++
  }
  sendVideo(h: number, f: { width: number; height: number; fps: number; data: ArrayBuffer }): void {
    void h
    this.frames.push({ width: f.width, height: f.height, fps: f.fps })
    const px = samplePx(f)
    if (px) {
      this.firstPx ??= px
      this.lastPx = px
      const black = px.every((p) => Math.max(...p) <= 8)
      if (black && this.seenContent) this.blackAfterContent++
      if (!black) this.seenContent = true
    }
  }
  sendAudio(
    h: number,
    a: { sampleRate: number; channels: number; samples: number; data: Float32Array }
  ): void {
    void h
    this.audio++
    this.lastAudioLen = a.data.length
  }
  connections(h: number): number {
    void h
    return 0
  }
  address(h: number): string {
    void h
    return this.kind === 'omt' ? 'omt://fake' : ''
  }
  videoStats(h: number): { frames: number; dropped: number } {
    void h
    return { frames: 0, dropped: 0 }
  }
  destroy(h: number): void {
    void h
    this.destroyed = true
  }
}

/** BGRA frame → [r,g,b] at (10,10) and at the top centre (x = w/2, y = 300/1080 of h); null if too short. */
function samplePx(f: { width: number; height: number; data: ArrayBuffer }): number[][] | null {
  if (f.data.byteLength < f.width * f.height * 4) return null
  const b = new Uint8Array(f.data)
  const at = (x: number, y: number): number[] => {
    const i = (y * f.width + x) * 4
    return [b[i + 2], b[i + 1], b[i]]
  }
  return [at(10, 10), at(Math.floor(f.width / 2), Math.floor((f.height * 300) / 1080))]
}
