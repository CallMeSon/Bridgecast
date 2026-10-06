import { describe, expect, it } from 'vitest'
import { cropOrPad, dipSize, fitMode, tolerance } from './output-geometry'

const target = { width: 1920, height: 1080 }

describe('dipSize', () => {
  it.each([
    [1, 1920, 1080],
    [1.12, 1714, 964],
    [1.25, 1536, 864],
    [1.5, 1280, 720],
    [2, 960, 540]
  ])('at scale %s sizes the window %s×%s DIP', (sf, w, h) => {
    expect(dipSize(1920, 1080, sf)).toEqual({ width: w, height: h })
  })

  it('treats a missing or bogus scale factor as 1', () => {
    expect(dipSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
    expect(dipSize(1920, 1080, NaN)).toEqual({ width: 1920, height: 1080 })
  })
})

describe('fitMode', () => {
  // Chromium paints round(dip * sf) device pixels; Windows may round the window
  // itself one DIP up or down (seen at 112 %: 1714 DIP asked, 1715 given).
  it.each([1, 1.12, 1.25, 1.5, 2])(
    'at scale %s the painted bitmap never needs resampling',
    (sf) => {
      const dip = dipSize(target.width, target.height, sf)
      for (const dw of [-1, 0, 1]) {
        for (const dh of [-1, 0, 1]) {
          const painted = {
            width: Math.round((dip.width + dw) * sf),
            height: Math.round((dip.height + dh) * sf)
          }
          const mode = fitMode(painted, target, tolerance(sf))
          expect(mode, `${sf}: ${JSON.stringify(painted)}`).not.toBe('resize')
          if (dw === 0 && dh === 0 && Number.isInteger(1920 / sf) && Number.isInteger(1080 / sf)) {
            expect(mode).toBe('exact')
          }
        }
      }
    }
  )

  it('is exact for an exact size', () => {
    expect(fitMode({ ...target }, target, 2)).toBe('exact')
  })

  it('resamples only for large mismatches (e.g. scale changed at runtime)', () => {
    expect(fitMode({ width: 2152, height: 1211 }, target, tolerance(1.12))).toBe('resize')
    expect(fitMode({ width: 1921, height: 1081 }, target, tolerance(1.12))).toBe('cropPad')
    expect(fitMode({ width: 1918, height: 1080 }, target, tolerance(1))).toBe('cropPad')
  })
})

describe('cropOrPad', () => {
  // 1 byte per channel BGRA; pixel value = row*16 + col in all of B, G, R.
  function bitmap(w: number, h: number): Buffer {
    const b = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        b[i] = b[i + 1] = b[i + 2] = y * 16 + x
        b[i + 3] = 255
      }
    }
    return b
  }
  const px = (b: Buffer, w: number, x: number, y: number): number[] => {
    const i = (y * w + x) * 4
    return [...b.subarray(i, i + 4)]
  }

  it('crops a larger bitmap to the top-left width×height', () => {
    const out = cropOrPad(bitmap(5, 4), 5, 4, 3, 2)
    expect(out.length).toBe(3 * 2 * 4)
    expect(px(out, 3, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(out, 3, 2, 1)).toEqual([18, 18, 18, 255])
  })

  it('pads a smaller bitmap with opaque black', () => {
    const out = cropOrPad(bitmap(2, 2), 2, 2, 4, 3)
    expect(out.length).toBe(4 * 3 * 4)
    expect(px(out, 4, 1, 1)).toEqual([17, 17, 17, 255])
    expect(px(out, 4, 3, 0)).toEqual([0, 0, 0, 255])
    expect(px(out, 4, 0, 2)).toEqual([0, 0, 0, 255])
  })

  it('handles wider-but-shorter bitmaps', () => {
    const out = cropOrPad(bitmap(5, 1), 5, 1, 4, 2)
    expect(out.length).toBe(4 * 2 * 4)
    expect(px(out, 4, 3, 0)).toEqual([3, 3, 3, 255])
    expect(px(out, 4, 3, 1)).toEqual([0, 0, 0, 255])
  })

  it('always returns exactly width*height*4 bytes at 1080p', () => {
    expect(cropOrPad(Buffer.alloc(1921 * 1081 * 4), 1921, 1081, 1920, 1080).length).toBe(
      1920 * 1080 * 4
    )
  })
})
