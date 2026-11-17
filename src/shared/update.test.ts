import { describe, expect, it } from 'vitest'
import { initialState } from './program'
import {
  canInstallNow,
  isNewerVersion,
  isPrerelease,
  isUpdateSupported,
  releaseNotesLines,
  releaseNotesText,
  sanitizeUpdates
} from './update'

describe('isNewerVersion', () => {
  it('compares semantic versions and rejects invalid candidates', () => {
    expect(isNewerVersion('1.2.0', '1.1.0')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.0.9', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.2.0-beta.1', '1.1.0')).toBe(true)
    expect(isNewerVersion('1.2.0-beta.1', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.2.0', '1.2.0-beta.1')).toBe(true)
    expect(isNewerVersion('v1.2.0', '1.1.0')).toBe(true)
    expect(isNewerVersion('nope', '1.1.0')).toBe(false)
  })
})

describe('isPrerelease', () => {
  it('recognises a valid pre-release suffix and rejects stable or invalid versions', () => {
    expect(isPrerelease('1.2.0-beta.1')).toBe(true)
    expect(isPrerelease('v2.0.0-rc.1+build.5')).toBe(true)
    expect(isPrerelease('1.2.0')).toBe(false)
    expect(isPrerelease('nope')).toBe(false)
  })
})

describe('releaseNotesLines', () => {
  it('renders headings, bullets with continuations, and paragraphs as plain text', () => {
    expect(releaseNotesLines('### Added\n- **Fast** start\n  continued\n\nPlain')).toEqual([
      { kind: 'heading', text: 'Added' },
      { kind: 'bullet', text: 'Fast start continued' },
      { kind: 'paragraph', text: 'Plain' }
    ])
  })

  it('returns no lines for empty notes', () => {
    expect(releaseNotesLines('')).toEqual([])
  })
})

describe('isUpdateSupported', () => {
  it('is false only for platforms without an update engine', () => {
    expect(isUpdateSupported({ kind: 'unsupported' })).toBe(false)
    expect(isUpdateSupported({ kind: 'idle' })).toBe(true)
    expect(isUpdateSupported({ kind: 'checking' })).toBe(true)
    expect(isUpdateSupported({ kind: 'available', version: '1.2.0', notes: '' })).toBe(true)
  })
})

describe('releaseNotesText', () => {
  it('turns the HTML notes GitHub serves into headings and bullets', () => {
    const html =
      '<h3>Added</h3>\n<ul>\n<li>Fast <strong>start</strong> &amp; stop</li>\n<li>Second</li>\n</ul>\n<p>Thanks.</p>'
    expect(releaseNotesText(html)).toBe('### Added\n- Fast start & stop\n- Second\nThanks.')
    expect(releaseNotesLines(releaseNotesText(html))).toEqual([
      { kind: 'heading', text: 'Added' },
      { kind: 'bullet', text: 'Fast start & stop' },
      { kind: 'bullet', text: 'Second' },
      { kind: 'paragraph', text: 'Thanks.' }
    ])
  })

  it('leaves markdown notes alone', () => {
    expect(releaseNotesText('### Added\n- a < b')).toBe('### Added\n- a < b')
  })
})

describe('canInstallNow', () => {
  it('refuses while the operator has the key visual on air', () => {
    expect(canInstallNow({ ...initialState, kv: true, kvUrl: 'slide://kv' })).toBe(false)
    expect(canInstallNow({ ...initialState, kvUrl: 'slide://kv' })).toBe(true)
  })

  it('allows install only when no slide is shown', () => {
    expect(canInstallNow(initialState)).toBe(true)
    expect(
      canInstallNow({ ...initialState, shown: { deckId: 'deck', index: 0, file: '001.png' } })
    ).toBe(false)
  })
})

describe('sanitizeUpdates', () => {
  it('defaults missing and invalid skipped versions to null and keeps strings', () => {
    expect(sanitizeUpdates(undefined)).toEqual({ skippedVersion: null })
    expect(sanitizeUpdates({ skippedVersion: 5 })).toEqual({ skippedVersion: null })
    expect(sanitizeUpdates({ skippedVersion: '1.2.0' })).toEqual({ skippedVersion: '1.2.0' })
  })
})
