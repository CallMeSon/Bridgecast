// Runs in the AudioWorklet thread (loaded by output-audio.ts). Plays PowerPoint's sound,
// which main sends as planar 10 ms blocks `{ data, samples: 480 }` (48 kHz stereo) over a
// MessagePort handed to this node as `{ port }`. A new port replaces the old one, which is closed.

import { PcmRing, type PcmData } from './pcm-ring'

export {}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

/** 40 ms before playing; at most 200 ms held (a stall never builds up delay). */
const PREBUFFER = 1920
const CAPACITY = 9600

class PcmSource extends AudioWorkletProcessor {
  private readonly ring = new PcmRing({ prebuffer: PREBUFFER, capacity: CAPACITY })
  private source: MessagePort | null = null

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<{ port?: MessagePort | null }>): void => {
      const next = e.data?.port ?? null
      if (this.source && this.source !== next) {
        this.source.onmessage = null
        this.source.close()
      }
      this.source = next
      if (next) next.onmessage = (m: MessageEvent<PcmData>): void => this.ring.write(m.data)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (!out?.[0]) return true
    this.ring.read(out[0], out[1] ?? out[0])
    return true
  }
}

registerProcessor('pcm-source', PcmSource)
