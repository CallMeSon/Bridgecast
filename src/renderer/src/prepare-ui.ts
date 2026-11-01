/** Pure rules for the Prepare window (kept out of the component so they can be tested). */
import type { PrepareBanner } from './model'

/** The address field shows what the operator typed while editing, else the page's own URL. */
export function addressShown(a: {
  pageUrl: string | null
  typed: string
  editing: boolean
}): string {
  if (a.editing) return a.typed
  return a.pageUrl ?? a.typed
}

function bare(url: string): string {
  const t = url.trim()
  return t.endsWith('/') ? t.slice(0, -1) : t
}

/** Home goes to the deck address; it has nothing to do when the page is already there. */
export function homeDisabled(pageUrl: string | null, deckUrl: string | undefined): boolean {
  if (!deckUrl) return true
  return pageUrl !== null && bare(pageUrl) === bare(deckUrl)
}

export type InteractEvent = { kind: 'banner'; banner: PrepareBanner } | { kind: 'press' }

/**
 * The Interact switch. Safest defaults: on only when the window opens on a deck that is
 * not on air; it never turns itself on after that. Live forces it off; frozen and "left
 * air" keep what the operator chose (off after live), so a click that changes what the
 * audience sees after Unfreeze is always deliberate.
 */
export function nextInteract(on: boolean, prev: PrepareBanner | null, e: InteractEvent): boolean {
  if (e.kind === 'press') return prev === 'live' ? false : !on
  if (e.banner === 'live') return false
  if (prev === null) return e.banner === 'idle'
  return on
}

/** On air and not frozen: main refuses input, so the switch is disabled. */
export function interactLocked(b: PrepareBanner): boolean {
  return b === 'live'
}

export type KeyRoute = 'page' | 'release' | 'leave' | 'pan' | 'app' | 'none'

/**
 * Where a key goes. F6 always leaves the page. Esc releases the keyboard (the caller also
 * sends it to the page). Live: app shortcuts. Space pans only while the page does not hold
 * the keyboard (Space in a text field types a space).
 */
export function keyRoute(
  e: { key: string; spaceForPan: boolean },
  s: { interact: boolean; holdsKeyboard: boolean; banner: PrepareBanner }
): KeyRoute {
  if (e.key === 'F6') return 'leave'
  if (e.key === 'Escape' && s.holdsKeyboard && s.interact) return 'release'
  if (s.banner === 'live') return 'app'
  if (e.key === ' ' && e.spaceForPan && !s.holdsKeyboard) return 'pan'
  if (s.interact && s.holdsKeyboard) return 'page'
  return 'none'
}

const CURSORS: Record<string, string> = {
  default: 'default',
  pointer: 'pointer',
  hand: 'pointer',
  text: 'text',
  ibeam: 'text',
  'vertical-text': 'vertical-text',
  wait: 'wait',
  progress: 'progress',
  crosshair: 'crosshair',
  cell: 'cell',
  move: 'move',
  'middle-panning': 'all-scroll',
  help: 'help',
  alias: 'alias',
  copy: 'copy',
  'context-menu': 'context-menu',
  grab: 'grab',
  grabbing: 'grabbing',
  'not-allowed': 'not-allowed',
  nodrop: 'no-drop',
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  'east-resize': 'e-resize',
  'west-resize': 'w-resize',
  'north-resize': 'n-resize',
  'south-resize': 's-resize',
  'north-east-resize': 'ne-resize',
  'north-west-resize': 'nw-resize',
  'south-east-resize': 'se-resize',
  'south-west-resize': 'sw-resize',
  'east-west-resize': 'ew-resize',
  'ew-resize': 'ew-resize',
  'north-south-resize': 'ns-resize',
  'ns-resize': 'ns-resize',
  'north-east-south-west-resize': 'nesw-resize',
  'north-west-south-east-resize': 'nwse-resize',
  'column-resize': 'col-resize',
  'row-resize': 'row-resize'
}

/** The page's Electron cursor type as a CSS cursor; unknown or `custom` gives `default`. */
export function cssCursor(electronType: string): string {
  return Object.prototype.hasOwnProperty.call(CURSORS, electronType)
    ? CURSORS[electronType]
    : 'default'
}

/**
 * The cursor over the stage. Panning wins, then a pan that is ready (grab), then locked
 * (not-allowed), then the page's own cursor while Interact is on, else default.
 */
export function stageCursor(s: {
  interact: boolean
  locked: boolean
  canPan: boolean
  panning: boolean
  page: string
}): string {
  if (s.panning) return 'grabbing'
  if (s.canPan) return 'grab'
  if (s.locked) return 'not-allowed'
  if (s.interact) return cssCursor(s.page)
  return 'default'
}

/** The view-row label for a changed page zoom; null at 100% (the default needs no warning). */
export function zoomLabel(zoom: number): string | null {
  if (zoom === 1) return null
  return `Page zoom ${Math.round(zoom * 100)}%`
}
