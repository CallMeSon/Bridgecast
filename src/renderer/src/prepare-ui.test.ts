import { describe, expect, it } from 'vitest'
import {
  addressShown,
  cssCursor,
  homeDisabled,
  inputLocked,
  keyRoute,
  nextInteract,
  stageCursor,
  zoomLabel,
  type InteractEvent
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
  const banner = (b: 'idle' | 'live' | 'frozen'): InteractEvent => ({ kind: 'banner', banner: b })
  it('opens on when the deck is not on air, off when it is frozen or live', () => {
    expect(nextInteract(false, null, banner('idle'))).toBe(true)
    expect(nextInteract(false, null, banner('frozen'))).toBe(false)
    expect(nextInteract(false, null, banner('live'))).toBe(false)
  })
  it('going live turns it off, whatever it was', () => {
    expect(nextInteract(true, 'idle', banner('live'))).toBe(false)
    expect(nextInteract(true, 'frozen', banner('live'))).toBe(false)
    expect(nextInteract(false, 'idle', banner('live'))).toBe(false)
  })
  it('leaving air turns it off (main drops its switch too)', () => {
    expect(nextInteract(true, 'live', banner('idle'))).toBe(false)
    expect(nextInteract(true, 'frozen', banner('idle'))).toBe(false)
    expect(nextInteract(false, 'frozen', banner('idle'))).toBe(false)
  })
  it('freezing keeps the choice', () => {
    expect(nextInteract(true, 'idle', banner('frozen'))).toBe(true)
    expect(nextInteract(true, 'live', banner('frozen'))).toBe(true)
  })
  it('a press toggles, on air too (main is asked first on air)', () => {
    expect(nextInteract(false, 'frozen', { kind: 'press' })).toBe(true)
    expect(nextInteract(true, 'idle', { kind: 'press' })).toBe(false)
    expect(nextInteract(false, 'live', { kind: 'press' })).toBe(true)
    expect(nextInteract(true, 'live', { kind: 'press' })).toBe(false)
  })
  it('unfreezing to live turns it off again', () => {
    const on = nextInteract(false, 'frozen', { kind: 'press' })
    expect(nextInteract(on, 'frozen', banner('live'))).toBe(false)
  })
})

describe('inputLocked', () => {
  it('is locked only on air with Interact off', () => {
    expect(inputLocked('live', false)).toBe(true)
    expect(inputLocked('live', true)).toBe(false)
    expect(inputLocked('frozen', false)).toBe(false)
    expect(inputLocked('idle', false)).toBe(false)
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
  it('on air without Interact the app shortcuts keep the keys', () => {
    expect(
      keyRoute({ key: ' ', spaceForPan: true }, { ...held, interact: false, banner: 'live' })
    ).toBe('app')
    expect(
      keyRoute(
        { key: 'ArrowRight', spaceForPan: false },
        { ...held, interact: false, banner: 'live' }
      )
    ).toBe('app')
  })
  it('on air with Interact the keys go to the page, not to the shortcuts', () => {
    expect(keyRoute({ key: ' ', spaceForPan: true }, { ...held, banner: 'live' })).toBe('page')
    expect(keyRoute({ key: 'ArrowRight', spaceForPan: false }, { ...held, banner: 'live' })).toBe(
      'page'
    )
    expect(keyRoute({ key: 'f', spaceForPan: false }, { ...held, banner: 'live' })).toBe('page')
  })
  it('on air with Interact, Esc stops Interact and never reaches the page', () => {
    expect(keyRoute({ key: 'Escape', spaceForPan: false }, { ...held, banner: 'live' })).toBe(
      'stop'
    )
  })
  it('F6 leaves the page on air too', () => {
    expect(keyRoute({ key: 'F6', spaceForPan: false }, { ...held, banner: 'live' })).toBe('leave')
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

describe('zoomLabel', () => {
  it('has no label at 100%', () => {
    expect(zoomLabel(1)).toBeNull()
  })
  it('names the percentage otherwise', () => {
    expect(zoomLabel(0.9)).toBe('Page zoom 90%')
    expect(zoomLabel(1.1)).toBe('Page zoom 110%')
    expect(zoomLabel(1.25)).toBe('Page zoom 125%')
  })
})
