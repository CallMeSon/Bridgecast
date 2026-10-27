// Runs in the AudioWorklet thread (loaded by output-audio.ts). Collects the
// 128-frame render quanta into planar blocks of 480 frames (10 ms at 48 kHz):
// 480 left samples then 480 right samples, posted as { data, samples: 480 }.
// The output stays silent; the node only exists to be pulled on.

export {}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

const FRAMES = 480

class OmtTap extends AudioWorkletProcessor {
  private block = new Float32Array(FRAMES * 2)
  private filled = 0

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const left = input?.[0]
    if (!left) return true
    const right = input[1] ?? left
    let i = 0
    while (i < left.length) {
      const n = Math.min(left.length - i, FRAMES - this.filled)
      this.block.set(left.subarray(i, i + n), this.filled)
      this.block.set(right.subarray(i, i + n), FRAMES + this.filled)
      this.filled += n
      i += n
      if (this.filled === FRAMES) {
        this.port.postMessage({ data: this.block, samples: FRAMES }, [this.block.buffer])
        this.block = new Float32Array(FRAMES * 2)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('omt-tap', OmtTap)
