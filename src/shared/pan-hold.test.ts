import { describe, expect, it } from 'vitest'
import { HOLD_MS, HOLD_SPEED, TAP_STEP, panPress } from './pan-hold'

describe('panPress', () => {
  it('a short press is one big step in its direction and never ticks', () => {
    const p = panPress('left', 1000)
    expect(p.tick(1100)).toBeNull()
    expect(p.release(1100)).toEqual({ dx: -TAP_STEP, dy: 0 })
  })
  it('a held press ticks small constant-speed steps and release adds nothing', () => {
    const p = panPress('down', 0)
    expect(p.tick(HOLD_MS - 1)).toBeNull()
    const a = p.tick(HOLD_MS + 16)
    const b = p.tick(HOLD_MS + 32)
    expect(a?.dx).toBe(0)
    expect(b?.dy).toBeCloseTo((HOLD_SPEED * 16) / 1000)
    expect(p.release(HOLD_MS + 40)).toBeNull()
  })
  it('caps a stalled frame', () => {
    const p = panPress('right', 0)
    p.tick(HOLD_MS + 16)
    expect(p.tick(HOLD_MS + 5000)?.dx).toBeCloseTo((HOLD_SPEED * 50) / 1000)
  })
})
