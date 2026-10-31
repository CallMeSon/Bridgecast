import { describe, expect, it } from 'vitest'
import {
  ACCENTS,
  ACCENT_IDS,
  PANEL,
  contrast,
  deriveAccent,
  parseAccent,
  parseHex,
  parseThemePref,
  resolveTheme,
  type Theme
} from './appearance'

const THEMES: Theme[] = ['light', 'dark']

describe('appearance parsing', () => {
  it('falls back for unknown values', () => {
    expect(parseThemePref('banana')).toBe('system')
    expect(parseThemePref(null)).toBe('system')
    expect(parseThemePref('dark')).toBe('dark')
    expect(parseAccent(undefined)).toBe('orange')
    expect(parseAccent('chartreuse')).toBe('orange')
    expect(parseAccent('rose')).toBe('rose')
    expect(parseAccent('custom')).toBe('custom')
  })

  it('resolves system against the OS', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('lists six accents in order', () => {
    expect(ACCENT_IDS).toEqual(['orange', 'violet', 'blue', 'rose', 'sand', 'custom'])
  })

  it('parses hex', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc')
    expect(parseHex('#12ab34')).toBe('#12ab34')
    expect(parseHex('red')).toBeNull()
    expect(parseHex(5)).toBeNull()
  })
})

describe('contrast', () => {
  it('matches the WCAG extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('accent presets', () => {
  for (const id of ACCENT_IDS) {
    for (const theme of THEMES) {
      it(`${id} ${theme} passes AA`, () => {
        const t = ACCENTS[id][theme]
        expect(contrast(t.ink, PANEL[theme])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.on, t.fill)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accent, PANEL[theme])).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('derived custom colours pass AA, including extremes', () => {
    for (const hex of ['#ff0000', '#00ff00', '#ffff00', '#000000', '#ffffff', '#808080', '#f26f1c']) {
      for (const theme of THEMES) {
        const t = deriveAccent(hex, theme)
        expect(contrast(t.ink, PANEL[theme])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.on, t.fill)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.accent, PANEL[theme])).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
