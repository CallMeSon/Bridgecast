import { describe, expect, it } from 'vitest'
import { fitMenuTop } from './menuNav'

describe('fitMenuTop', () => {
  it('shifts a menu up when it would pass the bottom edge', () => {
    expect(fitMenuTop(155, 500, 640)).toBe(132)
  })
  it('keeps a menu that fits where it is', () => {
    expect(fitMenuTop(100, 200, 640)).toBe(100)
  })
  it('never goes above the top margin', () => {
    expect(fitMenuTop(10, 900, 640)).toBe(8)
  })
})
