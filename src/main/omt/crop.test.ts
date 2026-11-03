import { describe, expect, it } from 'vitest'
import { cropBgra } from './crop'

/** A W x H bitmap where each pixel's B, G, R, A bytes encode its x and y, so a crop can be checked pixel by pixel. */
function bitmap(w: number, h: number): ArrayBuffer {
  const buf = new ArrayBuffer(w * h * 4)
  const px = new Uint8Array(buf)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px[i] = x & 255
      px[i + 1] = y & 255
      px[i + 2] = 7
      px[i + 3] = 255
    }
  return buf
}

describe('cropBgra', () => {
  it('the whole bitmap as the rect returns the same bytes', () => {
    const src = bitmap(8, 6)
    const out = cropBgra(src, 8, { x: 0, y: 0, width: 8, height: 6 })
    expect(out.byteLength).toBe(src.byteLength)
    expect(new Uint8Array(out)).toEqual(new Uint8Array(src))
  })

  it('a centred crop picks the pixels of that rectangle, row by row', () => {
    const src = bitmap(8, 6)
    const out = new Uint8Array(cropBgra(src, 8, { x: 2, y: 1, width: 4, height: 3 }))
    expect(out.byteLength).toBe(4 * 3 * 4)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4
        expect([out[i], out[i + 1], out[i + 2], out[i + 3]]).toEqual([x + 2, y + 1, 7, 255])
      }
  })

  it('an even, odd-positioned-free crop at the right and bottom edges keeps the last pixel', () => {
    const src = bitmap(10, 4)
    const out = new Uint8Array(cropBgra(src, 10, { x: 6, y: 2, width: 4, height: 2 }))
    const last = (1 * 4 + 3) * 4
    expect([out[last], out[last + 1]]).toEqual([9, 3])
  })

  it('a 1440x1080 content rect centred in 1920x1080 keeps the middle columns', () => {
    const w = 1920
    const h = 1080
    const src = new ArrayBuffer(w * h * 4)
    const px = new Uint8Array(src)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        px[i] = x & 255
        px[i + 1] = (x >> 8) & 255
        px[i + 2] = y & 255
        px[i + 3] = 255
      }
    const rect = { x: 240, y: 0, width: 1440, height: 1080 }
    const out = new Uint8Array(cropBgra(src, w, rect))
    expect(out.byteLength).toBe(1440 * 1080 * 4)
    const at = (x: number, y: number): number[] => {
      const i = (y * 1440 + x) * 4
      return [out[i] | (out[i + 1] << 8), out[i + 2]]
    }
    expect(at(0, 0)).toEqual([240, 0])
    expect(at(1439, 1079)).toEqual([1679, 1079 & 255])
  })

  it('returns a fresh buffer, leaving the source untouched', () => {
    const src = bitmap(4, 4)
    const before = new Uint8Array(src).slice()
    const out = cropBgra(src, 4, { x: 0, y: 0, width: 2, height: 2 })
    expect(out).not.toBe(src)
    expect(new Uint8Array(src)).toEqual(before)
  })
})
