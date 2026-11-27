import { describe, expect, it } from 'vitest'
import {
  ZOOM_OFF,
  ZOOM_MAX,
  coalesce,
  clampZoom,
  centreOn,
  isZoomed,
  zoomInstant,
  panBy,
  panDisabled,
  zoomAtPoint,
  viewRect,
  zoomBy,
  zoomTransform,
  type Zoom
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

  it('zoomAtPoint keeps the point under the pointer fixed', () => {
    const at = (z: Zoom, px: number, py: number): { x: number; y: number } => {
      const r = viewRect(z)
      return { x: r.x + px * r.w, y: r.y + py * r.h }
    }
    const z = { scale: 2, cx: 0.5, cy: 0.5 }
    const next = zoomAtPoint(z, 1.5, 0.25, 0.75)
    expect(next.scale).toBe(3)
    expect(at(next, 0.25, 0.75).x).toBeCloseTo(at(z, 0.25, 0.75).x)
    expect(at(next, 0.25, 0.75).y).toBeCloseTo(at(z, 0.25, 0.75).y)
  })

  it('zoomAtPoint from 1x, at the edges and at the limits', () => {
    const z = zoomAtPoint(ZOOM_OFF, 2, 0, 0)
    expect(z).toEqual({ scale: 2, cx: 0.25, cy: 0.25 })
    expect(zoomAtPoint(ZOOM_OFF, 0.5, 0.5, 0.5)).toEqual(ZOOM_OFF)
    expect(zoomAtPoint({ scale: 3, cx: 0.5, cy: 0.5 }, 10, 0.5, 0.5).scale).toBe(ZOOM_MAX)
    expect(zoomAtPoint({ scale: 2, cx: 0.5, cy: 0.5 }, 0.1, 0.9, 0.9)).toEqual(ZOOM_OFF)
  })
})

describe('coalesce', () => {
  it('sends only the newest value once per tick', () => {
    const sent: number[] = []
    let tick: (() => void) | null = null
    const c = coalesce<number>(
      (v) => sent.push(v),
      (run) => {
        tick = run
      }
    )
    c.push(1)
    c.push(2)
    c.push(3)
    expect(sent).toEqual([])
    tick!()
    expect(sent).toEqual([3])
    c.push(4)
    tick!()
    expect(sent).toEqual([3, 4])
  })
  it('flush sends a pending value immediately', () => {
    const sent: number[] = []
    const c = coalesce<number>(
      (v) => sent.push(v),
      () => {}
    )
    c.push(7)
    c.flush()
    expect(sent).toEqual([7])
  })
})

describe('zoomInstant', () => {
  const live = { take: 3, applies: true }
  it('zoom in, out, pan and Reset on the same take animate', () => {
    expect(zoomInstant(live, { take: 3, applies: true })).toBe(false)
  })
  it('a new take resets without motion', () => {
    expect(zoomInstant(live, { take: 4, applies: true })).toBe(true)
  })
  it('KV on or off (the zoom stops or starts applying) is a cut', () => {
    expect(zoomInstant(live, { take: 3, applies: false })).toBe(true)
    expect(zoomInstant({ take: 3, applies: false }, live)).toBe(true)
  })
})

describe('panDisabled', () => {
  it('disables every arrow at 1x', () => {
    expect(panDisabled(ZOOM_OFF)).toEqual({ left: true, right: true, up: true, down: true })
  })
  it('disables only the arrow facing a reached edge', () => {
    const z = clampZoom({ scale: 2, cx: 0, cy: 0.5 })
    expect(panDisabled(z)).toEqual({ left: true, right: false, up: false, down: false })
  })
})
