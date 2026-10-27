import { describe, expect, it } from 'vitest'
import { FakeSenderBinding } from './fake-binding'

function frame(w: number, h: number, bgr: [number, number, number]): ArrayBuffer {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgr[0]
    data[i + 1] = bgr[1]
    data[i + 2] = bgr[2]
    data[i + 3] = 255
  }
  return data.buffer
}

describe('FakeSenderBinding frame samples', () => {
  it('keeps the first and last pixels as [r,g,b] and counts black after content', () => {
    const f = new FakeSenderBinding('omt')
    const h = f.create('x')
    const send = (bgr: [number, number, number]): void =>
      f.sendVideo(h, { width: 40, height: 40, fps: 30, data: frame(40, 40, bgr) })
    send([0, 0, 0])
    send([10, 20, 30])
    send([0, 0, 0])
    expect(f.firstPx?.[0]).toEqual([0, 0, 0])
    expect(f.lastPx?.[0]).toEqual([0, 0, 0])
    expect(f.blackAfterContent).toBe(1)
    send([10, 20, 30])
    expect(f.lastPx?.[1]).toEqual([30, 20, 10])
  })

  it('records the audio block length', () => {
    const f = new FakeSenderBinding('omt')
    f.sendAudio(1, { sampleRate: 48000, channels: 2, samples: 480, data: new Float32Array(960) })
    expect(f.audio).toBe(1)
    expect(f.lastAudioLen).toBe(960)
  })
})
