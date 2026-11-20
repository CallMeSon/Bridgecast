import { describe, expect, it } from 'vitest'
import {
  ZOOM_OFF,
  ZOOM_MAX,
  clampZoom,
  centreOn,
  isZoomed,
  panBy,
  pointToCentre,
  viewRect,
  zoomBy,
  zoomTransform
} from './zoom'

describe('zoom maths', () => {
  it('isZoomed', () => {
    expect(isZoomed(ZOOM_OFF)).toBe(false)
    expect(isZoomed({ scale: 1.25, cx: 0.5, cy: 0.5 })).toBe(true)
  })

  it('clampZoom', () => {
    expect(clampZoom({ scale: 9, cx: 0.5, cy: 0.5 }).scale).toBe(4)
    expect(clampZoom({ scale: 0.2, cx: 0.1, cy: 0.9 })).toEqual({ scale: 1, cx: 0.5, cy: 0.5 })
    expect(clampZoom({ scale: 2, cx: 0, cy: 0.5 }).cx).toBe(0.25)
    expect(clampZoom({ scale: NaN, cx: 0.5, cy: 0.5 })).toEqual(ZOOM_OFF)
    expect(clampZoom({ scale: 2, cx: Infinity, cy: 0.5 })).toEqual(ZOOM_OFF)
  })

  it('zoomBy', () => {
    expect(zoomBy(ZOOM_OFF, 1.25).scale).toBe(1.25)
    let z = ZOOM_OFF
    for (let i = 0; i < 20; i++) z = zoomBy(z, 1.25)
    expect(z.scale).toBe(ZOOM_MAX)
  })

  it('panBy moves in visible-window units and stops at the edge', () => {
    const z = { scale: 2, cx: 0.5, cy: 0.5 }
    expect(panBy(z, 0.2, 0).cx).toBeCloseTo(0.5 + 0.5 * 0.2)
    expect(panBy(z, 10, 0).cx).toBe(0.75)
    expect(panBy(z, 0, -10).cy).toBe(0.25)
  })

  it('centreOn clamps', () => {
    expect(centreOn({ scale: 2, cx: 0.5, cy: 0.5 }, 5, -5)).toEqual({
      scale: 2,
      cx: 0.75,
      cy: 0.25
    })
  })

  it('zoomTransform', () => {
    expect(zoomTransform(ZOOM_OFF)).toBe('none')
    expect(zoomTransform({ scale: 2, cx: 0.75, cy: 0.25 })).toBe('translate(-100%, 0%) scale(2)')
  })

  it('viewRect', () => {
    expect(viewRect({ scale: 2, cx: 0.75, cy: 0.25 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    // Everything is a fraction of the canvas, so aspect (landscape or portrait) does not matter.
    const r = viewRect({ scale: 4, cx: 0.5, cy: 0.5 })
    expect(r.w).toBe(r.h)
  })

  it('pointToCentre', () => {
    expect(pointToCentre(1.5, -1)).toEqual({ cx: 1, cy: 0 })
    expect(pointToCentre(0.3, 0.6)).toEqual({ cx: 0.3, cy: 0.6 })
  })
})
