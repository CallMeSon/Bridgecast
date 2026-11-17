import { describe, expect, it } from 'vitest'
import { outputChanges, sanitizeEventOutputs } from './event-outputs'

describe('sanitizeEventOutputs', () => {
  it('keeps three booleans and drops other keys', () => {
    expect(sanitizeEventOutputs({ hdmi: true, omt: false, ndi: true, x: 1 })).toEqual({
      hdmi: true,
      omt: false,
      ndi: true
    })
  })

  it('refuses anything incomplete or not boolean', () => {
    expect(sanitizeEventOutputs(null)).toBeNull()
    expect(sanitizeEventOutputs([])).toBeNull()
    expect(sanitizeEventOutputs({ hdmi: true, omt: false })).toBeNull()
    expect(sanitizeEventOutputs({ hdmi: 1, omt: false, ndi: false })).toBeNull()
  })
})

describe('outputChanges', () => {
  it('lists only the outputs that differ', () => {
    const now = { hdmi: false, omt: true, ndi: false }
    expect(outputChanges({ hdmi: true, omt: true, ndi: false }, now)).toEqual({ hdmi: true })
    expect(outputChanges(now, now)).toEqual({})
  })
})
