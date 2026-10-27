import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DECK_AUDIO,
  effectiveGain,
  sanitizeDeckAudio,
  sanitizeVolume
} from './audio-levels'

describe('sanitizeVolume', () => {
  it('rounds to an integer', () => {
    expect(sanitizeVolume(55.6)).toBe(56)
    expect(sanitizeVolume(40)).toBe(40)
  })

  it('clamps to 0–100', () => {
    expect(sanitizeVolume(-3)).toBe(0)
    expect(sanitizeVolume(140)).toBe(100)
  })

  it('falls back for anything that is not a finite number', () => {
    for (const raw of ['x', NaN, Infinity, undefined, null, {}]) {
      expect(sanitizeVolume(raw)).toBe(100)
    }
    expect(sanitizeVolume(undefined, 70)).toBe(70)
  })
})

describe('sanitizeDeckAudio', () => {
  it('keeps valid values', () => {
    expect(sanitizeDeckAudio({ volume: 40, muted: true })).toEqual({ volume: 40, muted: true })
  })

  it('defaults a missing or non-object value to full volume, not muted', () => {
    expect(sanitizeDeckAudio({})).toEqual({ volume: 100, muted: false })
    expect(sanitizeDeckAudio(null)).toEqual({ volume: 100, muted: false })
    expect(sanitizeDeckAudio([])).toEqual({ volume: 100, muted: false })
    expect(DEFAULT_DECK_AUDIO).toEqual({ volume: 100, muted: false })
  })

  it('a muted flag that is not a boolean means not muted', () => {
    expect(sanitizeDeckAudio({ volume: 40, muted: 'yes' })).toEqual({ volume: 40, muted: false })
  })
})

describe('effectiveGain', () => {
  const master = { masterVolume: 100, muted: false }

  it('is 1 at full deck and master volume', () => {
    expect(effectiveGain({ volume: 100, muted: false }, master)).toBe(1)
  })

  it('multiplies deck and master', () => {
    expect(effectiveGain({ volume: 50, muted: false }, { masterVolume: 50, muted: false })).toBe(
      0.25
    )
  })

  it('is 0 when the deck or the master is muted, or the deck volume is 0', () => {
    expect(effectiveGain({ volume: 100, muted: true }, master)).toBe(0)
    expect(effectiveGain({ volume: 100, muted: false }, { masterVolume: 100, muted: true })).toBe(0)
    expect(effectiveGain({ volume: 0, muted: false }, master)).toBe(0)
  })
})
