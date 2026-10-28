import { describe, expect, it } from 'vitest'
import { pdfRenderSize } from './pdf-render'

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
})
