import type { Session } from 'electron'
import type { Canvas } from '../../shared/canvas'

/** Electron's default UA minus the `Electron/<v>` and `ppt-share/<v>` tokens, so sites see plain Chrome. */
export function chromeUserAgent(electronUa: string): string {
  return electronUa
    .replace(/\s(?:Electron|ppt-share)\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write'])

/** Everything not listed is denied (camera, mic, location, notifications, midi, hid, serial, usb, ...). */
export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission)
}

/** Only web pages: no mail, app-protocol, file, javascript or data URLs. */
export function navigationAllowed(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch {
    return false
  }
}

/** A page may open a window only while its deck is not on air. */
export function popupAllowed(live: boolean): boolean {
  return !live
}

export type PrepareInput =
  | {
      kind: 'mouse'
      type: 'mouseDown' | 'mouseUp' | 'mouseMove'
      x: number
      y: number
      button: 'left' | 'right' | 'middle'
      clickCount: number
    }
  | { kind: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | {
      kind: 'key'
      type: 'keyDown' | 'keyUp' | 'char'
      /** DOM `KeyboardEvent.key` style name or a single character. */
      keyCode: string
      modifiers: string[]
    }

const DOM_TO_ELECTRON_KEY: Readonly<Record<string, string>> = {
  ArrowRight: 'Right',
  ArrowLeft: 'Left',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Enter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  ' ': 'Space',
  space: 'Space',
  Space: 'Space'
}

/** DOM key name to the name `webContents.sendInputEvent` expects. Other names and characters pass through. */
export function electronKeyName(domKey: string): string {
  return Object.prototype.hasOwnProperty.call(DOM_TO_ELECTRON_KEY, domKey)
    ? DOM_TO_ELECTRON_KEY[domKey]
    : domKey
}

/** What `webContents.sendInputEvent` accepts, narrowed to the three kinds Prepare sends. */
export type PrepareEvent =
  Electron.MouseInputEvent | Electron.MouseWheelInputEvent | Electron.KeyboardInputEvent

const MOUSE_TYPES = new Set(['mouseDown', 'mouseUp', 'mouseMove'])
const BUTTONS = new Set(['left', 'right', 'middle'])
const KEY_TYPES = new Set(['keyDown', 'keyUp', 'char'])
const MODIFIERS = new Set(['shift', 'control', 'alt', 'meta'])
const MAX_KEY_LENGTH = 32
const MAX_WHEEL_DELTA = 100_000

function unit(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

function pixel(v: number, size: number): number {
  return Math.min(Math.max(Math.round(v * size), 0), Math.max(size - 1, 0))
}

function wheelDelta(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_WHEEL_DELTA) return null
  return v
}

/**
 * Checks one input event from the Prepare window and turns it into an Electron
 * input event in canvas pixels. Returns null for anything wrong, and for any input
 * while the deck is on air and not frozen (a stale renderer must not click on air).
 * Wheel deltas use the DOM sign (positive scrolls down); Electron wants the opposite.
 */
export function validatePrepareInput(
  raw: unknown,
  canvas: Canvas,
  deck: { live: boolean; frozen: boolean }
): PrepareEvent | null {
  if (deck.live && !deck.frozen) return null
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  if (r.kind === 'mouse') {
    if (typeof r.type !== 'string' || !MOUSE_TYPES.has(r.type)) return null
    if (!unit(r.x) || !unit(r.y)) return null
    if (typeof r.button !== 'string' || !BUTTONS.has(r.button)) return null
    if (
      !Number.isInteger(r.clickCount) ||
      (r.clickCount as number) < 0 ||
      (r.clickCount as number) > 3
    )
      return null
    return {
      type: r.type as 'mouseDown' | 'mouseUp' | 'mouseMove',
      x: pixel(r.x, canvas.width),
      y: pixel(r.y, canvas.height),
      button: r.button as 'left' | 'right' | 'middle',
      clickCount: r.clickCount as number
    }
  }

  if (r.kind === 'wheel') {
    if (!unit(r.x) || !unit(r.y)) return null
    const dx = wheelDelta(r.deltaX)
    const dy = wheelDelta(r.deltaY)
    if (dx === null || dy === null) return null
    return {
      type: 'mouseWheel',
      x: pixel(r.x, canvas.width),
      y: pixel(r.y, canvas.height),
      deltaX: dx === 0 ? 0 : -dx,
      deltaY: dy === 0 ? 0 : -dy,
      canScroll: true
    }
  }

  if (r.kind === 'key') {
    if (typeof r.type !== 'string' || !KEY_TYPES.has(r.type)) return null
    if (
      typeof r.keyCode !== 'string' ||
      r.keyCode.length === 0 ||
      r.keyCode.length > MAX_KEY_LENGTH
    )
      return null
    if (!Array.isArray(r.modifiers) || r.modifiers.length > MODIFIERS.size) return null
    if (!r.modifiers.every((m) => typeof m === 'string' && MODIFIERS.has(m))) return null
    // A char event carries the typed character itself; key events carry Electron key names.
    const keyCode = r.type === 'char' ? r.keyCode : electronKeyName(r.keyCode)
    return {
      type: r.type as 'keyDown' | 'keyUp' | 'char',
      keyCode,
      modifiers: [...(r.modifiers as Array<'shift' | 'control' | 'alt' | 'meta'>)]
    }
  }

  return null
}

/**
 * Applies the web source policy to the `persist:web` session: Chrome UA, deny-by-default
 * permissions (nothing at all for a live page), and every download cancelled.
 * Covered by the Task 8 end-to-end check, not by unit tests.
 */
export function applyWebSession(
  ses: Session,
  electronUa: string,
  isLive: (webContentsId: number) => boolean
): void {
  ses.setUserAgent(chromeUserAgent(electronUa))
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permissionAllowed(permission) && !(wc && isLive(wc.id)))
  })
  ses.setPermissionCheckHandler((wc, permission) => {
    return permissionAllowed(permission) && !(wc && isLive(wc.id))
  })
  ses.on('will-download', (event) => {
    event.preventDefault()
  })
}
