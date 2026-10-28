import { describe, it, expect } from 'vitest'
import { PcmRing } from './pcm-ring'

const block = (start: number, n: number): { data: Float32Array; samples: number } => {
  const data = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    data[i] = start + i
    data[n + i] = -(start + i)
  }
  return { data, samples: n }
}

describe('PcmRing', () => {
  it('plays silence until the pre-buffer is filled, then the samples in order', () => {
    const r = new PcmRing({ prebuffer: 100, capacity: 1000 })
    const l = new Float32Array(50)
    const rr = new Float32Array(50)
    r.write(block(1, 60))
    r.read(l, rr)
    expect(Array.from(l.subarray(0, 3))).toEqual([0, 0, 0])
    r.write(block(61, 60)) // 120 buffered >= 100
    r.read(l, rr)
    expect(l[0]).toBe(1)
    expect(l[49]).toBe(50)
    expect(rr[0]).toBe(-1)
    r.read(l, rr)
    expect(l[0]).toBe(51)
  })
  it('an underrun plays silence and waits for the pre-buffer again', () => {
    const r = new PcmRing({ prebuffer: 10, capacity: 1000 })
    r.write(block(1, 20))
    const l = new Float32Array(30)
    const rr = new Float32Array(30)
    r.read(l, rr)
    expect(l[19]).toBe(20)
    expect(l[20]).toBe(0)
    r.write(block(21, 5))
    r.read(l, rr)
    expect(l[0]).toBe(0) // only 5 buffered: still refilling
  })
  it('over capacity drops the oldest samples, keeping the delay bounded', () => {
    const r = new PcmRing({ prebuffer: 10, capacity: 100 })
    r.write(block(1, 80))
    r.write(block(81, 80)) // 160 > 100: the oldest 60 go
    expect(r.buffered).toBe(100)
    const l = new Float32Array(1)
    r.read(l, new Float32Array(1))
    expect(l[0]).toBe(61)
  })
  it('ignores a malformed block', () => {
    const r = new PcmRing({ prebuffer: 1, capacity: 100 })
    r.write({ data: new Float32Array(3), samples: 2 })
    r.write({ data: new Float32Array(0), samples: 0 })
    expect(r.buffered).toBe(0)
  })
})
