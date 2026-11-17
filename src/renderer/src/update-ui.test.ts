import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../shared/update'
import { announcedVersion, isUpdateKeyTarget, updateView } from './update-ui'

const available: UpdateStatus = {
  kind: 'available',
  version: '1.2.0',
  notes: '### Added\n- **Fast** start'
}

describe('announcedVersion', () => {
  it('returns the version for every announced status and null otherwise', () => {
    expect(announcedVersion({ kind: 'idle' })).toBeNull()
    expect(announcedVersion({ kind: 'checking' })).toBeNull()
    expect(announcedVersion({ kind: 'unsupported' })).toBeNull()
    expect(announcedVersion(available)).toBe('1.2.0')
    expect(announcedVersion({ kind: 'ready', version: '1.2.0' })).toBe('1.2.0')
    expect(announcedVersion({ kind: 'error', version: '1.2.0', message: 'oops' })).toBe('1.2.0')
  })
})

describe('updateView', () => {
  it('shows nothing while idle or checking', () => {
    const idle: UpdateStatus = { kind: 'idle' }
    const checking: UpdateStatus = { kind: 'checking' }
    expect(updateView(idle, false, null)).toEqual({ chip: null, banner: null, progress: null })
    expect(updateView(checking, false, null)).toEqual({ chip: null, banner: null, progress: null })
  })

  it('shows nothing when updates are unsupported on this build', () => {
    expect(updateView({ kind: 'unsupported' }, false, null)).toEqual({
      chip: null,
      banner: null,
      progress: null
    })
    expect(updateView({ kind: 'unsupported' }, true, null)).toEqual({
      chip: null,
      banner: null,
      progress: null
    })
  })

  it('announces an available version once, keeping the chip after Later', () => {
    const v = updateView(available, false, null)
    expect(v.chip).toEqual({ label: 'Update 1.2.0' })
    expect(v.banner).toMatchObject({
      title: 'Bridgecast 1.2.0 is available',
      primary: { label: 'Download', action: 'download' },
      primaryDisabledReason: null,
      showSkip: true,
      showLater: true
    })
    expect(v.progress).toBeNull()
    expect(v.banner?.detail).toBe('The download starts by itself.')
    expect(updateView(available, true, null).banner?.detail).toBe(
      'It downloads by itself once nothing is on air. You can also download it now.'
    )
    const dismissed = updateView(available, false, '1.2.0')
    expect(dismissed.banner).toBeNull()
    expect(dismissed.chip).toEqual({ label: 'Update 1.2.0' })
  })

  it('shows progress without an action while downloading', () => {
    const v = updateView({ kind: 'downloading', version: '1.2.0', percent: 40 }, false, null)
    expect(v.progress).toBe(40)
    expect(v.banner?.primary).toBeNull()
  })

  it('gates install while something is on air', () => {
    const ready: UpdateStatus = { kind: 'ready', version: '1.2.0' }
    const off = updateView(ready, false, null)
    expect(off.banner?.primary).toEqual({ label: 'Restart and install', action: 'install' })
    expect(off.banner?.primaryDisabledReason).toBeNull()
    const on = updateView(ready, true, null)
    expect(on.banner?.primaryDisabledReason).toBe(
      'Something is on air. Take it off air or wait until the show ends.'
    )
    expect(off.banner?.detail).toBe(
      'The update is downloaded. It installs when you close Bridgecast, or restart now.'
    )
    expect(on.banner?.detail).toBe(
      'The update is downloaded. It installs when you close Bridgecast with nothing on air.'
    )
    expect(off.banner?.showSkip).toBe(true)
  })

  it('offers a retry on error', () => {
    const v = updateView(
      { kind: 'error', version: '1.2.0', message: 'Download failed. Try again.' },
      false,
      null
    )
    expect(v.banner?.primary).toEqual({ label: 'Try again', action: 'retry' })
    expect(v.banner?.detail).toBe('Download failed. Try again.')
  })
})

describe('isUpdateKeyTarget', () => {
  const el = (matched: unknown): Element =>
    ({
      closest: (selector: string) => (selector === '[data-update-ui]' ? matched : null)
    }) as unknown as Element

  it('recognises update controls and their container', () => {
    expect(isUpdateKeyTarget(el({}))).toBe(true)
    expect(isUpdateKeyTarget(el(null))).toBe(false)
    expect(isUpdateKeyTarget(null)).toBe(false)
  })

  it('leaves update controls inside a dialog that owns the keyboard alone', () => {
    const inDialog = { closest: () => ({}) } as unknown as Element
    expect(isUpdateKeyTarget(inDialog)).toBe(false)
  })
})
