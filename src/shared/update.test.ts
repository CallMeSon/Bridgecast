import { describe, expect, it } from 'vitest'
import { initialState } from './program'
import {
  canInstallNow,
  isNewerVersion,
  isUpdateSupported,
  releaseNotesLines,
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

describe('canInstallNow', () => {
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
