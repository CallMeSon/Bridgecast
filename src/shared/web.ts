/** Shown when a typed web address is refused. */
export const WEB_URL_ERROR = 'Enter a web address that starts with https://.'
/** Shown next to an accepted http address. */
export const WEB_HTTP_WARNING = 'This page is not secure (http). Use https if the site supports it.'

/** Search engine for text that is not a web address. */
export const SEARCH_URL = 'https://www.google.com/search?q='

/**
 * Turns what the operator typed or pasted into a web deck URL. No scheme gets
 * `https://`; `http:` is accepted with a warning; text that is not an address
 * (spaces, or a single word without a dot) becomes a search; every other scheme
 * and empty input are refused.
 */
export function sanitizeWebUrl(
  input: string
): { url: string; warning?: string } | { error: string } {
  const text = input.trim()
  if (text === '') return { error: WEB_URL_ERROR }
  // A scheme is `letters:` followed by `//`, or a known no-slash scheme; a bare
  // `host:port` is not one.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)
  const hasScheme =
    !!scheme &&
    (text.slice(scheme[0].length).startsWith('//') || !/^\d/.test(text.slice(scheme[0].length)))
  // Not an address (spaces, or one word without a dot): search for it, like a browser.
  if (!hasScheme && (/\s/.test(text) || !/[.:/]/.test(text)) && !/^localhost$/i.test(text)) {
    return { url: SEARCH_URL + encodeURIComponent(text) }
  }
  const withScheme = hasScheme ? text : `https://${text}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { error: WEB_URL_ERROR }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: WEB_URL_ERROR }
  if (parsed.hostname === '' || /\s/.test(text.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0])) {
    return { error: WEB_URL_ERROR }
  }
  if (parsed.protocol === 'http:') return { url: parsed.href, warning: WEB_HTTP_WARNING }
  return { url: parsed.href }
}

/** The hostname of a web deck URL without a leading `www.`; the input itself when it is not a URL. */
export function webDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/** Load state of a web deck's page (`web:status`). */
export type WebStatus = 'loading' | 'ready' | 'error'

/** Outputs main counts as putting a page on air (ready gate, capture ended). */
export interface WebOutputs {
  hdmi: boolean
  omt: boolean
}

/** What an output captures: a web deck's page, or a native deck's PowerPoint slide show. */
export type CaptureKind = 'web' | 'slides'

/** How a web deck's page is captured: Electron's tab capture, or a helper window. */
export type WebCaptureKind = 'tab' | 'desktop'

/** The capture source of one web deck's page for the calling window. */
export interface WebCaptureSource {
  /** `tab` capture id (`webContents.getMediaSourceId`) or `window:<handle>:<n>`. */
  id: string
  /** Which `chromeMediaSource` the renderer must ask for. */
  kind: WebCaptureKind
}

/**
 * An output that shows a still (a web deck's snapshot, or the PNG of a native
 * slide) because it cannot capture the live picture. `kind` is absent for a web deck.
 */
export interface WebCaptureWarning {
  output: 'hdmi' | 'omt'
  deckId: string
  kind?: 'slides'
}

/** Operator warning for a failed capture on one output (spec 6). */
export function captureWarningText(output: 'hdmi' | 'omt', kind: CaptureKind = 'web'): string {
  const where = output === 'hdmi' ? 'HDMI' : 'OMT'
  return kind === 'slides'
    ? `The slide show cannot be shown on ${where}. It shows still slides.`
    : `The web page cannot be shown on ${where}. It shows the last snapshot.`
}

/** One input event from the Prepare preview, coordinates 0 to 1 of the preview (checked in main). */
export type PrepareInput =
  | {
      kind: 'mouse'
      type: 'mouseDown' | 'mouseUp' | 'mouseMove' | 'mouseLeave'
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

/** Page zoom steps of a web deck; 1 is the default and is never stored. */
export const PAGE_ZOOMS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2] as const

export function isPageZoom(v: unknown): v is number {
  return typeof v === 'number' && (PAGE_ZOOMS as readonly number[]).includes(v)
}

export const ZOOM_LIVE_REFUSED = 'Freeze first or take another deck, then change the page zoom.'

/** What a web page is doing, for the Prepare window. */
export interface WebNavState {
  deckId: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  zoom: number
  cursor: string
}

/**
 * Linux, Settings: "Use Chrome for web pages" and "Sign in to Google". The backend is chosen once
 * at start, so a change of the setting only applies after a restart (`restartNeeded`), also while
 * a web deck is on air: the page on air is never touched.
 */
export interface WebChromeStatus {
  /** False off Linux: the section is not shown. */
  supported: boolean
  /** The saved setting. */
  enabled: boolean
  /** The browser found on this PC (its file name), or null. */
  browser: string | null
  /** Operator copy for why Chrome cannot be used on this PC (none, Snap, no python3), or null. */
  problem: string | null
  /** This session's web pages run in Chrome. */
  active: boolean
  /** The saved setting differs from what this session runs. */
  restartNeeded: boolean
  /** The sign-in Chrome window is open right now. */
  signInOpen: boolean
}
