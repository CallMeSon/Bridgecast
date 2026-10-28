import { describe, expect, it } from 'vitest'
import { MAX_PDF_PIXELS, MAX_PDF_SIDE, pdfRenderSize } from './pdf-render'

const stage = { width: 1920, height: 1080 }
const page = { width: 960, height: 720 } // 4:3 PDF page in points

describe('pdfRenderSize', () => {
  it('contain renders the whole page inside the stage, at device pixels', () => {
    // scale = min(1920/960, 1080/720) * 2 = 3
    expect(pdfRenderSize(stage, page, 'fit', 2)).toEqual({ width: 2880, height: 2160, scale: 3 })
  })
  it('cover renders the page large enough to fill the stage', () => {
    // scale = max(2, 1.5) * 2 = 4
    expect(pdfRenderSize(stage, page, 'fill', 2)).toEqual({ width: 3840, height: 2880, scale: 4 })
  })
  it('stretch renders exactly the stage in device pixels', () => {
    expect(pdfRenderSize(stage, page, 'stretch', 2)).toEqual({
      width: 3840,
      height: 2160,
      scale: 4
    })
  })
  it('dpr 1 matches the stage', () => {
    expect(pdfRenderSize(stage, { width: 1920, height: 1080 }, 'fit', 1)).toEqual({
      width: 1920,
      height: 1080,
      scale: 1
    })
  })
  it('never returns a zero size', () => {
    const r = pdfRenderSize({ width: 0, height: 0 }, page, 'fit', 2)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  describe('pixel caps', () => {
    const area = (r: { width: number; height: number }): number => r.width * r.height
    it('normal sizes are unchanged', () => {
      expect(pdfRenderSize(stage, page, 'fit', 2).width).toBe(2880)
    })
    it('3840x1080 at dpr 2 (16.6 MP) is clamped to the area cap, aspect kept', () => {
      const r = pdfRenderSize(
        { width: 3840, height: 1080 },
        { width: 3840, height: 1080 },
        'fit',
        2
      )
      expect(area(r)).toBeLessThanOrEqual(MAX_PDF_PIXELS * 1.001)
      expect(r.width / r.height).toBeCloseTo(3840 / 1080, 2)
      expect(r.scale).toBeLessThan(2)
    })
    it('3840x2160 at dpr 2 is clamped', () => {
      const r = pdfRenderSize(
        { width: 3840, height: 2160 },
        { width: 1920, height: 1080 },
        'fit',
        2
      )
      expect(area(r)).toBeLessThanOrEqual(MAX_PDF_PIXELS * 1.001)
      expect(r.width / r.height).toBeCloseTo(16 / 9, 2)
    })
    it('an extreme width is clamped to the side cap', () => {
      const r = pdfRenderSize({ width: 7680, height: 100 }, { width: 7680, height: 100 }, 'fit', 2)
      expect(r.width).toBe(MAX_PDF_SIDE)
      expect(r.height).toBe(Math.round(200 * (MAX_PDF_SIDE / 15360)))
    })
    it('cover that exceeds the stage is clamped too', () => {
      const r = pdfRenderSize(
        { width: 3840, height: 2160 },
        { width: 100, height: 1000 },
        'fill',
        2
      )
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_PDF_SIDE)
      expect(area(r)).toBeLessThanOrEqual(MAX_PDF_PIXELS * 1.001)
      expect(r.width / r.height).toBeCloseTo(0.1, 2)
    })
    it('stretch is clamped', () => {
      const r = pdfRenderSize({ width: 3840, height: 2160 }, page, 'stretch', 2)
      expect(area(r)).toBeLessThanOrEqual(MAX_PDF_PIXELS * 1.001)
    })
  })
})
