import { describe, expect, it } from 'vitest'
import {
  centred,
  clampPan,
  layout,
  cycleZoom,
  effectiveZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  stepZoom,
  toPage,
  zoomAt,
  type View
} from './prepare-view'
import { stageRect } from './stage'

const canvas = { width: 1920, height: 1080 }
const box = { width: 1084, height: 610 }
const actual = (panX = 0, panY = 0): View => ({ mode: 'zoom', zoom: 1, panX, panY })

describe('layout', () => {
  it('fit equals stageRect', () => {
    const b = { width: 1084, height: 700 }
    const l = layout(canvas, b, { mode: 'fit', zoom: 1, panX: 0, panY: 0 }, 1)
    expect(l).toMatchObject(stageRect(canvas, b))
    expect(l.width).toBe(1084)
    expect(l.height).toBeCloseTo(609.75)
    expect(l.top).toBeCloseTo((700 - 609.75) / 2)
    expect(l.cropped).toBe(false)
  })

  it('actual at dpr 1 is cropped and centred pan is (418, 235)', () => {
    const c = centred(canvas, box, 1)
    expect(c).toEqual({ mode: 'zoom', zoom: 1, panX: 418, panY: 235 })
    const l = layout(canvas, box, c, 1)
    expect(l.width).toBe(1920)
    expect(l.cropped).toBe(true)
    expect(l.left).toBe(-418)
  })

  it('actual at dpr 2 is not cropped, centred, pan ignored', () => {
    const l = layout(canvas, box, actual(500, 500), 2)
    expect(l.width).toBe(960)
    expect(l.height).toBe(540)
    expect(l.cropped).toBe(false)
    expect(l.left).toBe((1084 - 960) / 2)
    expect(l.top).toBe((610 - 540) / 2)
    expect(centred(canvas, box, 2)).toEqual(actual(0, 0))
  })
})

describe('pan', () => {
  it('clampPan limits to the page', () => {
    expect(clampPan(canvas, box, actual(-50, 9999), 1)).toEqual(actual(0, 1080 - 610))
  })

  it('panBy moves the page with the drag', () => {
    expect(panBy(canvas, box, actual(418, 235), 1, 100, 40)).toEqual(actual(318, 195))
    expect(panBy(canvas, box, actual(0, 0), 2, 100, 40)).toEqual(actual(0, 0))
  })
})

describe('toPage', () => {
  const stage = { left: 10, top: 20 }

  it('fit centre is (0.5, 0.5)', () => {
    const b = { width: 1084, height: 700 }
    const l = layout(canvas, b, { mode: 'fit', zoom: 1, panX: 0, panY: 0 }, 1)
    const p = toPage(stage.left + 542, stage.top + 350, stage, l)
    expect(p!.x).toBeCloseTo(0.5)
    expect(p!.y).toBeCloseTo(0.5)
  })

  it('actual panned to bottom-right maps the last pixel to about (1, 1)', () => {
    const l = layout(canvas, box, actual(836, 470), 1)
    const p = toPage(stage.left + box.width, stage.top + box.height, stage, l)
    expect(p!.x).toBeCloseTo(1, 6)
    expect(p!.y).toBeCloseTo(1, 6)
  })

  it('maps a drawn page pixel back at every corner and centred', () => {
    const views = [actual(0, 0), actual(836, 0), actual(0, 470), actual(836, 470)]
    for (const v of [...views, centred(canvas, box, 1)]) {
      const l = layout(canvas, box, v, 1)
      const p = toPage(
        stage.left + l.left + 1000 * l.scale,
        stage.top + l.top + 500 * l.scale,
        stage,
        l
      )
      expect(p).not.toBeNull()
      expect(Math.abs(p!.x - 1000 / 1920)).toBeLessThan(1e-6)
      expect(Math.abs(p!.y - 500 / 1080)).toBeLessThan(1e-6)
    }
  })

  it('is null outside an uncropped page', () => {
    const l = layout(canvas, box, actual(), 2)
    expect(toPage(stage.left + 5, stage.top + 5, stage, l)).toBeNull()
  })
})

describe('zoom', () => {
  const fit: View = { mode: 'fit', zoom: 1, panX: 0, panY: 0 }

  it('zoomAt keeps the page point under the pointer fixed', () => {
    const start = zoomAt(canvas, box, centred(canvas, box, 1), 1, 1, 300, 200)
    const before = layout(canvas, box, start, 1)
    const pageX = (300 - before.left) / before.scale
    const pageY = (200 - before.top) / before.scale
    const v = zoomAt(canvas, box, start, 1, 2, 300, 200)
    const after = layout(canvas, box, v, 1)
    expect(v.zoom).toBe(2)
    expect((300 - after.left) / after.scale).toBeCloseTo(pageX)
    expect((200 - after.top) / after.scale).toBeCloseTo(pageY)
  })

  it('zoomAt from Fit keeps the page point and ends in zoom mode', () => {
    const l = layout(canvas, box, fit, 1)
    const px = 700
    const py = 400
    const pageX = (px - l.left) / l.scale
    const v = zoomAt(canvas, box, fit, 1, 1, px, py)
    expect(v.mode).toBe('zoom')
    const after = layout(canvas, box, v, 1)
    expect((px - after.left) / after.scale).toBeCloseTo(pageX)
  })

  it('clamps the zoom and the pan', () => {
    expect(zoomAt(canvas, box, fit, 1, 99, 0, 0).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(canvas, box, fit, 1, 0.01, 0, 0).zoom).toBe(MIN_ZOOM)
    const v = zoomAt(canvas, box, fit, 1, 4, 1084, 610)
    expect(v.panX).toBeLessThanOrEqual(1920 - 1084 / 4)
    expect(v.panY).toBeLessThanOrEqual(1080 - 610 / 4)
  })

  it('toPage maps a drawn page pixel back at 200% and 50%', () => {
    for (const z of [2, 0.5]) {
      const v = zoomAt(canvas, box, fit, 1, z, 400, 300)
      const l = layout(canvas, box, v, 1)
      const p = toPage(
        10 + l.left + 1000 * l.scale,
        20 + l.top + 500 * l.scale,
        { left: 10, top: 20 },
        l
      )
      expect(p!.x).toBeCloseTo(1000 / 1920, 6)
      expect(p!.y).toBeCloseTo(500 / 1080, 6)
    }
  })

  it('effectiveZoom reads the Fit scale and the zoom', () => {
    expect(effectiveZoom(canvas, box, fit, 1)).toBeCloseTo(1084 / 1920)
    expect(effectiveZoom(canvas, box, actual(), 1)).toBe(1)
  })

  it('stepZoom walks the stops and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(0.56, 1)).toBe(0.75)
    expect(stepZoom(0.56, -1)).toBe(0.5)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(0.25, -1)).toBe(0.25)
  })

  it('cycleZoom goes Fit, 100, 200, 50, Fit', () => {
    expect(cycleZoom(fit, 0.56)).toBe(1)
    expect(cycleZoom(actual(), 1)).toBe(2)
    expect(cycleZoom({ ...actual(), zoom: 2 }, 2)).toBe(0.5)
    expect(cycleZoom({ ...actual(), zoom: 0.5 }, 0.5)).toBe('fit')
    expect(cycleZoom({ ...actual(), zoom: 1.5 }, 1.5)).toBe(1)
  })
})
