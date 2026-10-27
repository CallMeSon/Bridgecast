/**
 * Protocol-neutral sender. OMT implements it through libomt; NDI will
 * implement the same interface later. `address` is '' and `videoStats` zeros
 * when a protocol has none.
 */
export interface SenderBinding {
  create(name: string): number
  sendVideo(h: number, f: { width: number; height: number; fps: number; data: ArrayBuffer }): void
  sendAudio(
    h: number,
    a: { sampleRate: number; channels: number; samples: number; data: Float32Array }
  ): void
  connections(h: number): number
  address(h: number): string
  videoStats(h: number): { frames: number; dropped: number }
  destroy(h: number): void
}
