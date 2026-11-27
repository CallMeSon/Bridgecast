import { describe, expect, it } from 'vitest'
import {
  CLICKER_KEYS,
  DEFAULT_GLOBAL_CLICKER,
  sanitizeGlobalClicker,
  shouldRegisterClicker
} from './clicker'

const base = { enabled: true, operatorOpen: true, bridgecastFocused: false }

describe('shouldRegisterClicker', () => {
  it('claims the keys only when on, operator open and no Bridgecast window focused', () => {
    expect(shouldRegisterClicker(base)).toBe(true)
    expect(shouldRegisterClicker({ ...base, enabled: false })).toBe(false)
    expect(shouldRegisterClicker({ ...base, operatorOpen: false })).toBe(false)
    expect(shouldRegisterClicker({ ...base, bridgecastFocused: true })).toBe(false)
  })
})

describe('sanitizeGlobalClicker', () => {
  it('defaults on and accepts only booleans', () => {
    expect(DEFAULT_GLOBAL_CLICKER).toBe(true)
    expect(sanitizeGlobalClicker(undefined)).toBe(true)
    expect(sanitizeGlobalClicker('no')).toBe(true)
    expect(sanitizeGlobalClicker(false)).toBe(false)
    expect(sanitizeGlobalClicker(true)).toBe(true)
  })
})

describe('CLICKER_KEYS', () => {
  it('maps PageDown/Right to next and PageUp/Left to prev', () => {
    const m = Object.fromEntries(CLICKER_KEYS.map((k) => [k.accelerator, k.action.type]))
    expect(m).toEqual({ PageDown: 'next', Right: 'next', PageUp: 'prev', Left: 'prev' })
  })
})
