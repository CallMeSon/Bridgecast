import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { clampSavedBounds, prepareBounds } from './prepare-window'

describe('prepareBounds', () => {
  it('uses 92% of a 1920x1040 work area, centred', () => {
    expect(prepareBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      width: 1600,
      height: 957,
      x: 160,
      y: 42
    })
  })
  it('shrinks on a 1366x728 work area', () => {
    const b = prepareBounds({ x: 0, y: 0, width: 1366, height: 728 })
    expect(b.width).toBe(1257)
    expect(b.height).toBe(670)
  })
  it('caps at 1600x1000 on a large display and honours its origin', () => {
    expect(prepareBounds({ x: 1920, y: 0, width: 3840, height: 2100 })).toEqual({
      width: 1600,
      height: 1000,
      x: 1920 + 1120,
      y: 550
    })
  })
})

describe('clampSavedBounds', () => {
  const a = { x: 0, y: 0, width: 1920, height: 1040 }
  const b = { x: 1920, y: 0, width: 1920, height: 1040 }
  const ok = { x: 100, y: 50, width: 1200, height: 800 }
  it('keeps a reachable rectangle as saved', () => {
    expect(clampSavedBounds(ok, [a, b])).toEqual(ok)
  })
  it('rejects corrupt values', () => {
    for (const bad of [
      null,
      'x',
      42,
      {},
      { ...ok, width: Number.NaN },
      { ...ok, x: '100' },
      { ...ok, height: Infinity },
      { ...ok, width: 100 },
      { ...ok, height: 300 },
      { ...ok, width: 1e9 }
    ]) {
      expect(clampSavedBounds(bad, [a])).toBeNull()
    }
  })
  it('returns null when the saved display is gone', () => {
    expect(clampSavedBounds({ ...ok, x: 2000 }, [a])).toBeNull()
    expect(clampSavedBounds({ ...ok, x: -3000 }, [a])).toBeNull()
  })
  it('pulls a partly off-screen window back inside its display', () => {
    const r = clampSavedBounds({ x: 1000, y: 700, width: 1200, height: 800 }, [a])
    expect(r).toEqual({ x: 720, y: 240, width: 1200, height: 800 })
  })
  it('shrinks a window larger than the display', () => {
    const small = { x: 0, y: 0, width: 1366, height: 728 }
    const r = clampSavedBounds({ x: 0, y: 0, width: 1600, height: 1000 }, [small])
    expect(r).toEqual({ x: 0, y: 0, width: 1366, height: 728 })
  })
  it('snaps to the display it mostly sits on', () => {
    const r = clampSavedBounds({ x: 1800, y: 0, width: 1200, height: 800 }, [a, b])
    expect(r?.x).toBe(1920)
  })
})
