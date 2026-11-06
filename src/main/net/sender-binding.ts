/**
 * Protocol-neutral sender. OMT implements it through libomt; NDI will
 * implement the same interface later. `address` is ''
 * when a protocol has none.
 */
/** The network protocols that send a Program picture. */
export type NetId = 'omt' | 'ndi'

export interface SenderBinding {
  create(name: string): number
  sendVideo(h: number, f: { width: number; height: number; fps: number; data: ArrayBuffer }): void
  sendAudio(
    h: number,
    a: { sampleRate: number; channels: number; samples: number; data: Float32Array }
  ): void
  connections(h: number): number
  address(h: number): string
  destroy(h: number): void
}
