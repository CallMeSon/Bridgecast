import { describe, expect, it } from 'vitest'
import {
  appTabCapture,
  chromeUserAgent,
  electronKeyName,
  frameNavigationAllowed,
  navigationAllowed,
  permissionAllowed,
  popupAllowed,
  validatePrepareInput
} from './policy'

const canvas = { width: 3840, height: 1080 }
const idle = { live: false, frozen: false }

describe('chromeUserAgent', () => {
  it('strips the Electron and app tokens and keeps Chrome', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ppt-share/1.2.3 Chrome/140.0.7339.0 Electron/45.0.0 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.0 Safari/537.36'
    )
  })
  it('leaves a plain Chrome UA alone', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
    expect(chromeUserAgent(ua)).toBe(ua)
  })
})

describe('permissionAllowed', () => {
  it.each(['fullscreen', 'clipboard-sanitized-write'])('allows %s', (p) => {
    expect(permissionAllowed(p)).toBe(true)
  })
  it.each([
    'media',
    'geolocation',
    'notifications',
    'midi',
    'midiSysex',
    'hid',
    'serial',
    'usb',
    'clipboard-read',
    'display-capture',
    'pointerLock',
    'openExternal',
    'unknown',
    ''
  ])('denies %s', (p) => {
    expect(permissionAllowed(p)).toBe(false)
  })
})

describe('navigationAllowed', () => {
  it.each(['https://canva.com/design/x', 'http://example.com/a?b=1'])('allows %s', (u) => {
    expect(navigationAllowed(u)).toBe(true)
  })
  it.each([
    'mailto:a@b.c',
    'canva:open',
    'ms-word:ofe|u|https://x',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'about:blank',
    'not a url',
    ''
  ])('refuses %s', (u) => {
    expect(navigationAllowed(u)).toBe(false)
  })
})

describe('frameNavigationAllowed', () => {
  it('main frame: only http and https', () => {
    expect(frameNavigationAllowed('https://a.org/', true)).toBe(true)
    expect(frameNavigationAllowed('http://a.org/', true)).toBe(true)
    for (const u of ['about:srcdoc', 'about:blank', 'blob:https://a.org/x', 'data:text/html,hi']) {
      expect(frameNavigationAllowed(u, true)).toBe(false)
    }
  })
  it.each([
    'https://a.org/embed',
    'http://a.org/',
    'about:srcdoc',
    'about:blank',
    'blob:https://a.org/1234',
    'data:text/html,hi'
  ])('subframe allows %s (embeds and widgets)', (u) => {
    expect(frameNavigationAllowed(u, false)).toBe(true)
  })
  it.each([
    'mailto:a@b.c',
    'canva:open',
    'ms-word:ofe|u|https://x',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    ''
  ])('subframe refuses %s', (u) => {
    expect(frameNavigationAllowed(u, false)).toBe(false)
  })
})

describe('popupAllowed', () => {
  it('allows popups only while not live', () => {
    expect(popupAllowed(false)).toBe(true)
    expect(popupAllowed(true)).toBe(false)
  })
})

describe('electronKeyName', () => {
  it.each([
    ['ArrowRight', 'Right'],
    ['ArrowLeft', 'Left'],
    ['ArrowUp', 'Up'],
    ['ArrowDown', 'Down'],
    ['PageUp', 'PageUp'],
    ['PageDown', 'PageDown'],
    ['Enter', 'Enter'],
    ['Escape', 'Escape'],
    ['Backspace', 'Backspace'],
    ['Tab', 'Tab'],
    ['Delete', 'Delete'],
    ['Home', 'Home'],
    ['End', 'End'],
    [' ', 'Space'],
    ['space', 'Space'],
    ['Space', 'Space'],
    ['a', 'a'],
    ['A', 'A'],
    ['5', '5'],
    ['F5', 'F5']
  ])('maps %j to %j', (dom, electron) => {
    expect(electronKeyName(dom)).toBe(electron)
  })
})

describe('validatePrepareInput', () => {
  const click = { kind: 'mouse', type: 'mouseDown', x: 0.5, y: 0.5, button: 'left', clickCount: 1 }

  it('refuses while live and not frozen', () => {
    expect(validatePrepareInput(click, canvas, { live: true, frozen: false })).toBeNull()
  })
  it('accepts while live and frozen', () => {
    expect(validatePrepareInput(click, canvas, { live: true, frozen: true })).not.toBeNull()
  })
  it('maps normalised coordinates to rounded canvas pixels', () => {
    expect(validatePrepareInput(click, canvas, idle)).toEqual({
      type: 'mouseDown',
      x: 1920,
      y: 540,
      button: 'left',
      clickCount: 1
    })
    expect(validatePrepareInput({ ...click, x: 0.3333, y: 0.1 }, canvas, idle)).toMatchObject({
      x: 1280,
      y: 108
    })
  })
  it('keeps the edge inside the canvas', () => {
    expect(validatePrepareInput({ ...click, x: 1, y: 1 }, canvas, idle)).toMatchObject({
      x: 3839,
      y: 1079
    })
    expect(validatePrepareInput({ ...click, x: 0, y: 0 }, canvas, idle)).toMatchObject({
      x: 0,
      y: 0
    })
  })
  it.each([1.2, -0.1, NaN, Infinity, '0.5', null, undefined])('refuses x=%s', (x) => {
    expect(validatePrepareInput({ ...click, x }, canvas, idle)).toBeNull()
  })
  it('refuses unknown kinds, types, buttons and junk', () => {
    expect(validatePrepareInput({ ...click, kind: 'touch' }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...click, type: 'mouseEnter' }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...click, button: 'back' }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...click, clickCount: 99 }, canvas, idle)).toBeNull()
    expect(validatePrepareInput(null, canvas, idle)).toBeNull()
    expect(validatePrepareInput('x', canvas, idle)).toBeNull()
  })
  it('maps wheel with DOM sign to the Electron sign (negative scrolls down)', () => {
    const w = { kind: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 120 }
    expect(validatePrepareInput(w, canvas, idle)).toEqual({
      type: 'mouseWheel',
      x: 1920,
      y: 540,
      deltaX: 0,
      deltaY: -120,
      canScroll: true
    })
    expect(validatePrepareInput({ ...w, deltaY: NaN }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...w, deltaY: 1e9 }, canvas, idle)).toBeNull()
  })
  it('maps key events to Electron key names', () => {
    const k = { kind: 'key', type: 'keyDown', keyCode: 'ArrowRight', modifiers: ['shift'] }
    expect(validatePrepareInput(k, canvas, idle)).toEqual({
      type: 'keyDown',
      keyCode: 'Right',
      modifiers: ['shift']
    })
    expect(validatePrepareInput({ ...k, keyCode: ' ' }, canvas, idle)).toMatchObject({
      keyCode: 'Space'
    })
  })
  it('keeps the literal character for char events', () => {
    const c = { kind: 'key', type: 'char', keyCode: ' ', modifiers: [] }
    expect(validatePrepareInput(c, canvas, idle)).toEqual({
      type: 'char',
      keyCode: ' ',
      modifiers: []
    })
    expect(validatePrepareInput({ ...c, keyCode: 'H' }, canvas, idle)).toMatchObject({
      keyCode: 'H'
    })
  })
  it('refuses bad keys', () => {
    const k = { kind: 'key', type: 'keyDown', keyCode: 'a', modifiers: [] }
    expect(validatePrepareInput({ ...k, keyCode: 'x'.repeat(33) }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...k, keyCode: '' }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...k, type: 'keyPress' }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...k, modifiers: ['hyper'] }, canvas, idle)).toBeNull()
    expect(validatePrepareInput({ ...k, modifiers: 'shift' }, canvas, idle)).toBeNull()
  })
})

describe('appTabCapture', () => {
  const DEV = 'http://localhost:5173'
  it('allows display-capture asked by an app window (file: or dev server origin)', () => {
    expect(appTabCapture('display-capture', 'file:///', undefined)).toBe(true)
    expect(appTabCapture('display-capture', 'http://localhost:5173', DEV)).toBe(true)
  })
  it('refuses a page asking for screen capture, other permissions and a missing origin', () => {
    expect(appTabCapture('display-capture', 'https://www.canva.com', DEV)).toBe(false)
    expect(appTabCapture('display-capture', 'http://localhost:5173', undefined)).toBe(false)
    expect(appTabCapture('display-capture', undefined, undefined)).toBe(false)
    expect(appTabCapture('media', 'file:///', undefined)).toBe(false)
  })
})
