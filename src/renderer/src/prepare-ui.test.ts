import { describe, expect, it } from 'vitest'
import {
  addressShown,
  cssCursor,
  homeDisabled,
  interactLocked,
  keyRoute,
  nextInteract,
  stageCursor
} from './prepare-ui'

describe('addressShown', () => {
  it('keeps the typed text while editing, even when the page URL changes', () => {
    expect(addressShown({ pageUrl: 'https://b.com/', typed: 'https://a', editing: true })).toBe(
      'https://a'
    )
  })
  it('shows the page URL when not editing', () => {
    expect(addressShown({ pageUrl: 'https://b.com/', typed: 'https://a', editing: false })).toBe(
      'https://b.com/'
    )
  })
  it('shows the typed text before the page has a URL', () => {
    expect(addressShown({ pageUrl: null, typed: 'https://a', editing: false })).toBe('https://a')
  })
})

describe('homeDisabled', () => {
  it('is disabled when the page is at the deck address, ignoring one trailing slash', () => {
    expect(homeDisabled('https://a.com/', 'https://a.com')).toBe(true)
    expect(homeDisabled('https://a.com', 'https://a.com/')).toBe(true)
  })
  it('is enabled on a different path', () => {
    expect(homeDisabled('https://a.com/next', 'https://a.com')).toBe(false)
  })
  it('is disabled without a deck address', () => {
    expect(homeDisabled('https://a.com', undefined)).toBe(true)
  })
})

describe('nextInteract', () => {
  it('opens on when the deck is not on air', () => {
    expect(nextInteract(false, null, { kind: 'banner', banner: 'idle' })).toBe(true)
  })
  it('opens off when the deck is frozen or live', () => {
    expect(nextInteract(false, null, { kind: 'banner', banner: 'frozen' })).toBe(false)
    expect(nextInteract(false, null, { kind: 'banner', banner: 'live' })).toBe(false)
  })
  it('goes off when the deck goes live', () => {
    expect(nextInteract(true, 'idle', { kind: 'banner', banner: 'live' })).toBe(false)
    expect(nextInteract(true, 'frozen', { kind: 'banner', banner: 'live' })).toBe(false)
  })
  it('stays off when live is frozen and when the deck leaves air', () => {
    expect(nextInteract(false, 'live', { kind: 'banner', banner: 'frozen' })).toBe(false)
    expect(nextInteract(false, 'frozen', { kind: 'banner', banner: 'idle' })).toBe(false)
  })
  it('keeps an operator choice when frozen arrives', () => {
    expect(nextInteract(true, 'idle', { kind: 'banner', banner: 'frozen' })).toBe(true)
  })
  it('a press toggles, except while live', () => {
    expect(nextInteract(false, 'frozen', { kind: 'press' })).toBe(true)
    expect(nextInteract(true, 'idle', { kind: 'press' })).toBe(false)
    expect(nextInteract(false, 'live', { kind: 'press' })).toBe(false)
  })
  it('unfreezing to live turns it off again', () => {
    const on = nextInteract(false, 'frozen', { kind: 'press' })
    expect(nextInteract(on, 'frozen', { kind: 'banner', banner: 'live' })).toBe(false)
  })
})

describe('interactLocked', () => {
  it('is locked only while live', () => {
    expect(interactLocked('live')).toBe(true)
    expect(interactLocked('frozen')).toBe(false)
    expect(interactLocked('idle')).toBe(false)
  })
})

describe('keyRoute', () => {
  const held = { interact: true, holdsKeyboard: true, banner: 'idle' as const }
  it('F6 always leaves, never the page', () => {
    for (const s of [held, { ...held, banner: 'live' as const }, { ...held, interact: false }])
      expect(keyRoute({ key: 'F6', spaceForPan: true }, s)).toBe('leave')
  })
  it('Escape releases only while the page holds the keyboard', () => {
    expect(keyRoute({ key: 'Escape', spaceForPan: false }, held)).toBe('release')
    expect(keyRoute({ key: 'Escape', spaceForPan: false }, { ...held, holdsKeyboard: false })).toBe(
      'none'
    )
  })
  it('Space types into the page while it holds the keyboard, even when cropped', () => {
    expect(keyRoute({ key: ' ', spaceForPan: true }, held)).toBe('page')
  })
  it('Space pans when cropped and the page does not hold the keyboard', () => {
    expect(keyRoute({ key: ' ', spaceForPan: true }, { ...held, holdsKeyboard: false })).toBe('pan')
  })
  it('live keeps the app shortcuts', () => {
    expect(keyRoute({ key: ' ', spaceForPan: true }, { ...held, banner: 'live' })).toBe('app')
  })
  it('nothing goes to the page with Interact off', () => {
    expect(keyRoute({ key: 'a', spaceForPan: false }, { ...held, interact: false })).toBe('none')
  })
})

describe('cssCursor', () => {
  it('maps Electron cursor types to CSS', () => {
    expect(cssCursor('hand')).toBe('pointer')
    expect(cssCursor('pointer')).toBe('pointer')
    expect(cssCursor('ibeam')).toBe('text')
    expect(cssCursor('wait')).toBe('wait')
    expect(cssCursor('ew-resize')).toBe('ew-resize')
    expect(cssCursor('east-west-resize')).toBe('ew-resize')
  })
  it('falls back to default for custom and unknown', () => {
    expect(cssCursor('custom')).toBe('default')
    expect(cssCursor('xyz')).toBe('default')
    expect(cssCursor('constructor')).toBe('default')
  })
})

describe('stageCursor', () => {
  const base = { interact: true, locked: false, canPan: false, panning: false, page: 'hand' }
  it('panning wins', () => {
    expect(stageCursor({ ...base, canPan: true, panning: true })).toBe('grabbing')
  })
  it('a ready pan shows grab, also while locked on air', () => {
    expect(stageCursor({ ...base, canPan: true })).toBe('grab')
    expect(stageCursor({ ...base, interact: false, locked: true, canPan: true })).toBe('grab')
  })
  it('locked with nothing to pan is not-allowed', () => {
    expect(stageCursor({ ...base, interact: false, locked: true })).toBe('not-allowed')
  })
  it('Interact on follows the page cursor', () => {
    expect(stageCursor(base)).toBe('pointer')
  })
  it('Interact off with nothing to pan is default', () => {
    expect(stageCursor({ ...base, interact: false })).toBe('default')
  })
})
