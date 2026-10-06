import type { NdiFormat, NdiSender } from './sender'

/** In-memory NdiSender for tests: records every call, touches no NDI library. */
export class FakeNdiSender implements NdiSender {
  readonly starts: NdiFormat[] = []
  /** Byte length of every frame handed to sendBgra (frames are not kept). */
  readonly frames: number[] = []
  stops = 0
  running = false

  start(o: NdiFormat): void {
    this.starts.push({ ...o })
    this.running = true
  }

  sendBgra(frame: Buffer): void {
    this.frames.push(frame.length)
  }

  stop(): void {
    this.stops++
    this.running = false
  }
}
