import type { WebCaptureSource, WebNavState } from '../../shared/web'

/** A capture source as the backends and the IPC layer name it. */
export type CaptureSource = WebCaptureSource

/** Canvas pixels (the page window's client size must be exactly this). */
export interface PageSize {
  width: number
  height: number
}

/** What `open` needs: the address, the canvas, the page zoom and the sign-in profile. */
export interface PageOpenOptions {
  url: string
  canvas: PageSize
  zoom: number
  /** `default` unless the deck has its own WebView2 profile. */
  profile: string
  /** The deck is on the output (a page on air may not open a window). */
  live?: boolean
}

/**
 * Events a backend reports for its pages. `WebHost` owns the operator-facing decisions
 * (ready gate, HOLD, status text); a backend only reports what happened to the page.
 */
export interface PageBackendEvents {
  /** Navigation state changed (url, title, history, loading, cursor). */
  nav(s: WebNavState): void
  /**
   * A new main-frame document started loading (a new URL, Reload, history, or the
   * backend's own reload after a crash): the previous load and failure no longer describe
   * the page. Never sent for the error page of a failed load, a subframe or a
   * same-document navigation, so a `nav` report alone (even with `loading`) never ends an
   * error.
   */
  navStarted(deckId: string): void
  /** The main frame finished loading successfully. */
  loaded(deckId: string, info: { title: string; url: string }): void
  /** The main-frame load failed; `message` is the operator copy. */
  loadFailed(deckId: string, message: string): void
  /** The page stopped (renderer crash or browser exit). The backend reloads on its own. */
  crashed(deckId: string, message: string): void
  /** The page did not respond for a while (HOLD while it is on air). */
  hung(deckId: string): void
  /** The page window is not the canvas size (undefined = it is). */
  warning(deckId: string, warning: string | undefined): void
  /** The page went away (its window closed). */
  closed(deckId: string): void
}

/**
 * What `WebHost` needs from a page: the operations it does on it today. Two
 * implementations: Electron's hidden `BrowserWindow` (fallback, all platforms) and the
 * Windows `web-bridge.exe` helper hosting WebView2.
 */
export interface PageBackend {
  /** The backend reports to these events (set once by WebHost). */
  setEvents(events: PageBackendEvents): void
  /** Opens a page and resolves when its window exists. */
  open(deckId: string, o: PageOpenOptions): Promise<void>
  /** Loads a new address in an open page. */
  load(deckId: string, url: string): Promise<void>
  reload(deckId: string): Promise<void>
  back(deckId: string): Promise<void>
  forward(deckId: string): Promise<void>
  /** Stops a load in progress (allowed on air: it only ends a load). */
  stop(deckId: string): void
  /** Next/Prev on air: exactly one keyDown and one keyUp. */
  key(deckId: string, key: 'ArrowRight' | 'ArrowLeft'): void
  /** One already validated input event, in canvas pixels, without focusing the page. */
  input(deckId: string, ev: Electron.InputEvent): void
  setZoom(deckId: string, zoom: number): Promise<void>
  resize(canvas: PageSize): void
  /** Capture source for `requester` (a `WebContents` on Electron; ignored by WebView2). */
  captureSource(deckId: string, requester: unknown): Promise<WebCaptureSource>
  /** A PNG of the page as it is now (null when there is no frame yet). */
  snapshot(deckId: string): Promise<Buffer | null>
  /** True for a page window this backend owns (Electron profiles; false for the helper). */
  owns?(wc: Electron.WebContents): boolean
  /** How many popup (sign-in) windows a page has open (diagnostics). */
  popups?(deckId: string): number
  /** Named pipe carrying the page's sound (web-bridge only); null when there is none. */
  audioPipe?(deckId: string): string | null
  /** Mutes the page's own playback (the Electron page is always muted; tab capture carries it). */
  setMuted?(deckId: string, muted: boolean): void
  /** The deck went on or off the output (the helper's popup rule). */
  setLive?(deckId: string, live: boolean): void
  /** Extra diagnostics for `PPT_OUTPUT_DUMP`. */
  debug?(deckId: string): Promise<Record<string, unknown> | null>
  /** Clears the sign-in data of the given profiles and reloads their pages. */
  signOut(profiles: string[]): Promise<void>
  close(deckId: string): void
  /** Quit: every page and helper process goes. */
  dispose(): void
}

/** The operator copy for a page that could not open (same as the Electron host). */
export function loadFailedText(domain: string): string {
  return `Could not open ${domain}. Check the internet connection, then Reload.`
}
