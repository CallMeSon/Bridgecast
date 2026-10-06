/** Name and video format of the NDI source. */
export interface NdiFormat {
  name: string
  width: number
  height: number
  fps: number
}

/**
 * The only part of the app that touches NDI. Everything else (pipeline,
 * output window, IPC) talks to this interface; tests use FakeNdiSender.
 */
export interface NdiSender {
  /** (Re)starts the source with this name and format. */
  start(o: NdiFormat): void
  /** One BGRA frame of exactly width*height*4 bytes. The caller never mutates it afterwards. */
  sendBgra(frame: Buffer): void
  stop(): void
}
