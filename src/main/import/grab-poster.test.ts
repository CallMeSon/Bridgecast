import { describe, expect, it } from 'vitest'
import { posterTime } from './grab-poster'

describe('posterTime', () => {
  it('takes the frame 0.1 s in, or 10% of a short clip', () => {
    expect(posterTime(10)).toBe(0.1)
    expect(posterTime(0.5)).toBe(0.05)
  })
  it('is 0 for a duration that cannot be used', () => {
    expect(posterTime(0)).toBe(0)
    expect(posterTime(-2)).toBe(0)
    expect(posterTime(NaN)).toBe(0)
    expect(posterTime(Infinity)).toBe(0)
  })
})
