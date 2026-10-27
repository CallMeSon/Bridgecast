import type { SenderBinding } from './sender-binding'

/** Recording SenderBinding for tests; touches no native library. */
export class FakeSenderBinding implements SenderBinding {
  frames: { width: number; height: number; fps: number }[] = []
  audio = 0
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
  }
  sendAudio(
    h: number,
    a: { sampleRate: number; channels: number; samples: number; data: Float32Array }
  ): void {
    void h
    void a
    this.audio++
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
