import { describe, expect, it } from 'vitest'
import { fontWarning, missingFonts, parseFcList } from './fonts'

describe('missingFonts', () => {
  it('lists used fonts that are not installed, case-insensitive, unique and sorted', () => {
    expect(
      missingFonts(
        ['Segoe UI', 'calibri', 'Calibri', 'Arial', 'Segoe UI'],
        ['arial', 'Liberation Sans']
      )
    ).toEqual(['calibri', 'Segoe UI'])
  })

  it('keeps aliases literal (no metric-compatible substitution is assumed)', () => {
    expect(missingFonts(['Calibri'], ['Carlito'])).toEqual(['Calibri'])
  })

  it('is empty when everything is installed or nothing is used', () => {
    expect(missingFonts(['Arial'], ['ARIAL'])).toEqual([])
    expect(missingFonts([], ['Arial'])).toEqual([])
  })

  it('ignores blank names and theme placeholders', () => {
    expect(missingFonts(['', '  ', '+mn-lt', '+mj-ea', 'Foo'], [])).toEqual(['Foo'])
  })

  it('keeps the first spelling of a font that appears in several cases', () => {
    expect(missingFonts(['Segoe UI', 'SEGOE UI'], [])).toEqual(['Segoe UI'])
  })
})

describe('fontWarning', () => {
  it('is null without missing fonts', () => {
    expect(fontWarning([])).toBeNull()
  })

  it('joins the list with ", " in the exact copy', () => {
    expect(fontWarning(['Calibri', 'Segoe UI'])).toBe(
      'This deck uses fonts that are not installed: Calibri, Segoe UI. The layout may shift. Install them, or the metric-compatible Carlito, Caladea or Liberation fonts.'
    )
  })
})

describe('parseFcList', () => {
  it('reads family names from `fc-list : family` (comma separated aliases, one line per font)', () => {
    expect(
      parseFcList('Carlito\nLiberation Sans,Liberation Sans Narrow\n\nDejaVu Sans\\-Bold\n')
    ).toEqual(['Carlito', 'Liberation Sans', 'Liberation Sans Narrow', 'DejaVu Sans-Bold'])
  })
})
