import { describe, expect, it } from 'vitest'
import {
  centred,
  clampPan,
  layout,
  miniMap,
  panBy,
  panFromMiniMap,
  toPage,
  type View
} from './prepare-view'
import { stageRect } from './stage'

const canvas = { width: 1920, height: 1080 }
const box = { width: 1084, height: 610 }
const actual = (panX = 0, panY = 0): View => ({ mode: 'actual', panX, panY })

describe('layout', () => {
  it('fit equals stageRect', () => {
    const b = { width: 1084, height: 700 }
    const l = layout(canvas, b, { mode: 'fit', panX: 0, panY: 0 }, 1)
    expect(l).toMatchObject(stageRect(canvas, b))
    expect(l.width).toBe(1084)
    expect(l.height).toBeCloseTo(609.75)
    expect(l.top).toBeCloseTo((700 - 609.75) / 2)
    expect(l.cropped).toBe(false)
  })

  it('actual at dpr 1 is cropped and centred pan is (418, 235)', () => {
    const c = centred(canvas, box, 1)
    expect(c).toEqual({ mode: 'actual', panX: 418, panY: 235 })
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
    const l = layout(canvas, b, { mode: 'fit', panX: 0, panY: 0 }, 1)
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

describe('miniMap', () => {
  it('has the canvas aspect and a full rect at fit', () => {
    const m = miniMap(canvas, box, { mode: 'fit', panX: 0, panY: 0 }, 1)
    expect(m.width).toBe(168)
    expect(m.height).toBeCloseTo(94.5)
    expect(m.rect).toEqual({ x: 0, y: 0, w: 168, h: m.height })
  })

  it('shows the visible part at actual', () => {
    const m = miniMap(canvas, box, centred(canvas, box, 1), 1)
    const ms = 168 / 1920
    expect(m.rect.x).toBeCloseTo(418 * ms)
    expect(m.rect.y).toBeCloseTo(235 * ms)
    expect(m.rect.w).toBeCloseTo(1084 * ms)
    expect(m.rect.h).toBeCloseTo(610 * ms)
  })

  it('height is at least 24', () => {
    expect(miniMap({ width: 1920, height: 100 }, box, actual(), 1).height).toBe(24)
  })

  it('panFromMiniMap at the centre equals centred', () => {
    const m = miniMap(canvas, box, actual(), 1)
    const v = panFromMiniMap(canvas, box, 1, m.width / 2, m.height / 2)
    expect(v.mode).toBe('actual')
    expect(v.panX).toBeCloseTo(418)
    expect(v.panY).toBeCloseTo(235)
  })

  it('panFromMiniMap clamps at the corners', () => {
    expect(panFromMiniMap(canvas, box, 1, 0, 0)).toEqual(actual(0, 0))
    expect(panFromMiniMap(canvas, box, 1, 168, 94.5)).toEqual(actual(836, 470))
  })
})
