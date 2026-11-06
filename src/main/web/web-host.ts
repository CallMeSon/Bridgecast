import { BrowserWindow, screen, session, type Session, type WebContents } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { Library } from '../library'
import type { AppState } from '../state'
import type { Canvas } from '../../shared/canvas'
import type { DeckMeta } from '../../shared/types'
import { webDomain, ZOOM_LIVE_REFUSED, type WebNavState, type WebStatus } from '../../shared/web'
import {
  applyWebSession,
  electronKeyName,
  frameNavigationAllowed,
  interactAllowed,
  navigationAllowed,
  popupAction,
  validatePrepareInput,
  zoomAllowed
} from './policy'
import {
  failLoadIsError,
  holdBeforeNavigate,
  NavCoalescer,
  pageSizeWarning,
  syncPlan,
  webDeckName
} from './host-rules'
import { InteractSwitches } from './interact'

export type { WebStatus }

/** The one browser profile of every web deck (sign-ins persist across restarts). */
const WEB_PARTITION = 'persist:web'
/** A page that stays unresponsive this long while on air triggers HOLD. */
const UNRESPONSIVE_HOLD_MS = 5000
/** A crashed page is reloaded behind the scenes after this delay. */
const CRASH_RELOAD_MS = 1000
/** capturePage fails right after a load (no frame composited yet): retry this often. */
const SNAPSHOT_TRIES = 4
const SNAPSHOT_RETRY_MS = 500
/** Without a way to hear back from the outputs, HOLD before navigating waits this long. */
const HOLD_SETTLE_MS = 300

const SIGN_OUT_LIVE = 'Take another deck first, then sign out.'
const INTERACT_NOT_LIVE =
  'Interact works only while the web page is on air. Take the deck first, then turn Interact on.'
const NOT_OPEN = 'The web page is not open. Reload the deck, then try again.'

/** Same rules as the host page: separate profile, no Node, no preload. */
const PAGE_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  autoplayPolicy: 'no-user-gesture-required',
  spellcheck: false
} as const

interface Page {
  deckId: string
  win: BrowserWindow
  /** The main frame finished loading (and has not started another document since). */
  loaded: boolean
  /** An app window received a frame of this page's capture (ready gate). */
  frameSeen: boolean
  /** Last main-frame load failed or the renderer is gone. */
  failed: string | null
  status: WebStatus
  popups: Set<BrowserWindow>
  unresponsive: ReturnType<typeof setTimeout> | null
  crashReload: ReturnType<typeof setTimeout> | null
  /** Rename the deck after the page title on the next load (added without a name). */
  autoName: boolean
  /** The content size matches the canvas (a window can be clamped to the screen). */
  sizeOk: boolean
  /** Operator warning about the page window (its size), sent with its status. */
  warning?: string
  /** Last cursor type of the page (Electron cursor type string). */
  cursor: string
}

/**
 * One hidden window per web deck of the open event (plus the page on air), in the
 * `persist:web` session. Outputs and previews capture it with
 * `getMediaSourceId` + `chromeMediaSource: 'tab'`; a hidden window paints only
 * while it is captured. Electron-bound: the pure decisions live in host-rules.ts
 * and policy.ts; the rest is covered by the end-to-end test.
 */
export class WebHost {
  private pages = new Map<string, Page>()
  /** Interact per deck (see interact.ts); the owner is the window that turned it on. */
  private interact = new InteractSwitches<WebContents>()
  /** Owner windows whose close and navigation already drop their switches. */
  private watched = new WeakSet<WebContents>()
  private ses: Session | null = null
  /** The web deck on air at the last syncEvent, to snapshot it when it leaves. */
  private onAir: string | null = null
  private closed = false
  /** Decks whose HOLD before navigating still waits for the outputs to pause. */
  private holding = new Map<string, Promise<void>>()
  /**
   * HOLD before navigating a live page waits for this: the outputs report that their
   * stream is paused (`web:held`), or a timeout. Set by main.
   */
  waitHeld: (deckId: string) => Promise<unknown> = () =>
    new Promise((r) => setTimeout(r, HOLD_SETTLE_MS))

  constructor(
    private lib: Library,
    private state: AppState,
    private canvas: () => Canvas,
    private onStatus: (deckId: string, s: WebStatus, message?: string, warning?: string) => void,
    /** Where popups (sign-in windows) open: the operator window's display. */
    private operatorWindow: () => BrowserWindow | null = () => null,
    /** The dev server URL in development: its origin counts as an app window for tab capture. */
    private devUrl?: string,
    /** Navigation state of a page changed (coalesced; `loading` changes go at once). */
    onNav: (s: WebNavState) => void = () => {}
  ) {
    this.coalescer = new NavCoalescer(
      onNav,
      (fn, ms) => setTimeout(fn, ms),
      (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    )
  }

  private coalescer: NavCoalescer

  private session(): Session {
    if (!this.ses) {
      this.ses = session.fromPartition(WEB_PARTITION)
      applyWebSession(this.ses, this.ses.getUserAgent(), this.devUrl)
    }
    return this.ses
  }

  /** True for a web deck page or one of its popups (anything in the web profile). */
  owns(wc: WebContents): boolean {
    return this.ses !== null && wc.session === this.ses
  }

  /** The deck's page is on the output (frozen or not). */
  private live(deckId: string): boolean {
    return this.state.state.shown?.web?.deckId === deckId
  }

  /**
   * Opens pages for the web decks of `decks` that have none and closes pages of
   * decks no longer listed, except the one on air (`shownDeckId`): it closes once
   * it has left air. A web page leaving air is snapshotted first.
   */
  syncEvent(decks: DeckMeta[], shownDeckId: string | null): void {
    if (this.closed) return
    const left = this.onAir !== null && this.onAir !== shownDeckId ? this.onAir : null
    this.onAir = shownDeckId
    const plan = syncPlan(this.pages.keys(), decks, shownDeckId)
    // A deck removed from the library gets no snapshot: its window closes at once.
    const snap = left !== null && this.inLibrary(left) ? left : null
    for (const id of plan.close) {
      if (id === snap) void this.snapshot(id).finally(() => this.close(id))
      else this.close(id)
    }
    if (snap && !plan.close.includes(snap)) void this.snapshot(snap)
    for (const { deckId, url } of plan.open) this.open(deckId, url)
  }

  /** The next load of this deck's page renames the deck after the page title. */
  nameFromTitle(deckId: string): void {
    const p = this.pages.get(deckId)
    if (p) p.autoName = true
  }

  /** Ready gate: loaded, no failure, and a captured frame has been seen. */
  webReady(deckId: string): boolean {
    // While HOLD waits for the outputs to pause the old page still reads `ready`:
    // Resume web (or K/B off) now would cancel the HOLD and navigate unheld.
    if (this.holding.has(deckId)) return false
    const p = this.pages.get(deckId)
    return !!p && p.status === 'ready'
  }

  /** Every open page's current status. */
  statuses(): { deckId: string; status: WebStatus; message?: string; warning?: string }[] {
    return [...this.pages.values()].map((p) => ({
      deckId: p.deckId,
      status: p.status,
      ...(p.failed ? { message: p.failed } : {}),
      ...(p.warning ? { warning: p.warning } : {})
    }))
  }

  /**
   * Reload, Back, Forward and a new URL on the page on air (not frozen, not held):
   * HOLD first, and navigate only once the outputs hold their last frame, so the
   * audience never sees the next document (blank, error page) before the ready gate.
   * HOLD then ends only through Resume web (or another take, K, B).
   */
  private async holdFirst(deckId: string): Promise<void> {
    // A second navigation close to the first waits for the same HOLD.
    const pending = this.holding.get(deckId)
    if (pending) return pending
    const s = this.state.state
    if (!holdBeforeNavigate({ live: this.live(deckId), frozen: s.frozen, held: s.webHold })) return
    this.state.setWebHold(true)
    const wait = this.waitHeld(deckId)
      .then(() => undefined)
      .finally(() => this.holding.delete(deckId))
    this.holding.set(deckId, wait)
    return wait
  }

  async reload(deckId: string): Promise<void> {
    this.page(deckId)
    await this.holdFirst(deckId)
    const p = this.page(deckId)
    this.clearCrashReload(p)
    p.win.webContents.reload()
  }

  async navigate(deckId: string, url: string): Promise<void> {
    this.page(deckId)
    await this.holdFirst(deckId)
    const p = this.page(deckId)
    this.clearCrashReload(p)
    this.load(p, url)
  }

  /** Stops a load in progress. Allowed on air: it only ends a load. */
  stop(deckId: string): void {
    this.page(deckId).win.webContents.stop()
  }

  /** Loads the deck's saved address (HOLD first on air, like a new URL). */
  async home(deckId: string): Promise<void> {
    const url = this.lib.getDeck(deckId).web?.url
    if (!url) throw new Error(NOT_OPEN)
    await this.navigate(deckId, url)
  }

  /**
   * Page zoom of the deck, saved and applied. It changes what the audience sees, so it
   * is refused while the deck is on air and not frozen.
   */
  setZoom(deckId: string, zoom: number): DeckMeta {
    const p = this.page(deckId)
    if (!zoomAllowed({ live: this.live(deckId), frozen: this.state.state.frozen })) {
      throw new Error(ZOOM_LIVE_REFUSED)
    }
    const ev = this.lib.listEvents().find((e) => e.deckIds.includes(deckId))
    if (!ev) throw new Error(NOT_OPEN)
    const deck = this.lib.setWebZoom(ev.id, deckId, zoom)
    p.win.webContents.setZoomFactor(zoom)
    this.pushNav(p)
    return deck
  }

  /** Navigation state of every open page. */
  navStates(): WebNavState[] {
    return [...this.pages.values()].filter((p) => !p.win.isDestroyed()).map((p) => this.navState(p))
  }

  private navState(p: Page): WebNavState {
    const wc = p.win.webContents
    const h = wc.navigationHistory
    return {
      deckId: p.deckId,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: h.canGoBack(),
      canGoForward: h.canGoForward(),
      loading: wc.isLoading(),
      zoom: this.storedZoom(p.deckId),
      cursor: p.cursor
    }
  }

  private storedZoom(deckId: string): number {
    try {
      return this.lib.getDeck(deckId).web?.zoom ?? 1
    } catch {
      return 1
    }
  }

  private pushNav(p: Page): void {
    if (this.closed || p.win.isDestroyed()) return
    this.coalescer.push(this.navState(p))
  }

  async back(deckId: string): Promise<void> {
    if (!this.page(deckId).win.webContents.navigationHistory.canGoBack()) return
    await this.holdFirst(deckId)
    const h = this.page(deckId).win.webContents.navigationHistory
    if (h.canGoBack()) h.goBack()
  }

  async forward(deckId: string): Promise<void> {
    if (!this.page(deckId).win.webContents.navigationHistory.canGoForward()) return
    await this.holdFirst(deckId)
    const h = this.page(deckId).win.webContents.navigationHistory
    if (h.canGoForward()) h.goForward()
  }

  /**
   * Next/Prev on air: exactly one keyDown and one keyUp (no char, no repeat). The
   * hidden page is never focused: that could take the keyboard away from the
   * operator window, and sendInputEvent reaches the page without focus.
   */
  key(deckId: string, key: 'ArrowRight' | 'ArrowLeft'): void {
    const p = this.pages.get(deckId)
    if (!p || p.win.isDestroyed()) return
    const wc = p.win.webContents
    const keyCode = electronKeyName(key)
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
  }

  /**
   * Sends one already validated input event to the page, without focusing it
   * (typing into a clicked field works without focus, and the Prepare window keeps
   * the keyboard).
   */
  input(deckId: string, ev: Electron.InputEvent): void {
    const p = this.pages.get(deckId)
    if (!p || p.win.isDestroyed()) return
    p.win.webContents.sendInputEvent(ev as Electron.MouseInputEvent)
  }

  /**
   * Prepare input from a renderer: checked (0 to 1, known kinds, deck not on air
   * or frozen) and sent. False when refused.
   */
  prepareInput(deckId: string, raw: unknown): boolean {
    if (!this.pages.has(deckId)) return false
    const ev = validatePrepareInput(raw, this.canvas(), {
      live: this.live(deckId),
      frozen: this.state.state.frozen,
      interact: this.interacting(deckId)
    })
    if (!ev) return false
    this.input(deckId, ev)
    return true
  }

  /**
   * Interact on or off for a deck. On needs the page on air (refused otherwise); the
   * window that asked owns the switch and loses it when it closes or navigates. Off is
   * always allowed. Showing or hiding Interact never changes HOLD or Freeze.
   */
  setInteract(deckId: string, on: boolean, owner: WebContents): void {
    if (!interactAllowed(on, this.live(deckId))) throw new Error(INTERACT_NOT_LIVE)
    if (!on) {
      this.interact.clear(deckId)
      return
    }
    this.interact.set(deckId, owner)
    this.watchOwner(owner)
  }

  /** Interact is on for the deck on air: its page takes input while it is live. */
  interacting(deckId: string): boolean {
    return this.interact.has(deckId) && this.live(deckId)
  }

  /** Keeps Interact only for the deck on air in the open event (after every Program change). */
  syncInteract(eventId: string | null, onAir: string | null): void {
    this.interact.sync(eventId, onAir)
  }

  /** A window that owns Interact drops it when it is destroyed or loads another page. */
  private watchOwner(owner: WebContents): void {
    if (this.watched.has(owner)) return
    this.watched.add(owner)
    const drop = (): void => this.interact.releaseOwner(owner)
    owner.once('destroyed', drop)
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) drop()
    })
  }

  /** Capture id of the page for `requester` (valid 10 s, only for that WebContents). */
  sourceIdFor(deckId: string, requester: WebContents): string {
    const p = this.pages.get(deckId)
    if (!p || p.win.isDestroyed()) throw new Error(NOT_OPEN)
    return p.win.webContents.getMediaSourceId(requester)
  }

  /** An app window received a captured frame of the page (ready gate). */
  frameSeen(deckId: string): void {
    const p = this.pages.get(deckId)
    if (!p || p.frameSeen) return
    p.frameSeen = true
    this.updateStatus(p)
  }

  /** An output's capture track of the page ended: HOLD while the deck is on air. */
  captureEnded(deckId: string): void {
    this.hold(deckId)
  }

  /** The canvas changed: every page window follows it. */
  resize(): void {
    for (const p of this.pages.values()) this.fitSize(p)
  }

  /**
   * Clears every site's cookies, storage and cache in the web profile and reloads
   * the pages. Refused while a web deck is on air.
   */
  async signOut(): Promise<void> {
    if (this.state.state.shown?.web) throw new Error(SIGN_OUT_LIVE)
    const ses = this.session()
    await ses.clearStorageData()
    await ses.clearCache()
    for (const p of this.pages.values()) {
      for (const w of p.popups) if (!w.isDestroyed()) w.destroy()
      if (!p.win.isDestroyed()) p.win.webContents.reload()
    }
  }

  /** Quit: every page and popup goes, no reload timers remain. */
  shutdown(): void {
    this.closed = true
    for (const id of [...this.pages.keys()]) this.close(id)
  }

  /** PPT_OUTPUT_DUMP: page state per deck, the counter of the test page read on demand. */
  async debug(): Promise<
    Record<
      string,
      {
        status: WebStatus
        counter?: number
        webHold: boolean
        windowOpen: boolean
        frameSeen: boolean
        contentSize: number[]
        sizeOk: boolean
        url: string
      }
    >
  > {
    const out: Awaited<ReturnType<WebHost['debug']>> = {}
    for (const p of this.pages.values()) {
      if (p.win.isDestroyed()) continue
      const wc = p.win.webContents
      let counter: number | undefined
      try {
        // A page still loading never answers executeJavaScript: do not wait for it.
        const v = await Promise.race([
          wc.executeJavaScript('window.__counter'),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
        if (typeof v === 'number') counter = v
      } catch {
        // Page not loaded or crashed: no counter.
      }
      if (p.win.isDestroyed()) continue // closed while the counter was read
      out[p.deckId] = {
        status: p.status,
        ...(counter === undefined ? {} : { counter }),
        webHold: this.live(p.deckId) && this.state.state.webHold,
        windowOpen: [...p.popups].some((w) => !w.isDestroyed()),
        frameSeen: p.frameSeen,
        contentSize: p.win.getContentSize(),
        sizeOk: p.sizeOk,
        url: wc.getURL()
      }
    }
    return out
  }

  private inLibrary(deckId: string): boolean {
    try {
      this.lib.getDeck(deckId)
      return true
    } catch {
      return false
    }
  }

  private page(deckId: string): Page {
    const p = this.pages.get(deckId)
    if (!p || p.win.isDestroyed()) throw new Error(NOT_OPEN)
    return p
  }

  private open(deckId: string, url: string): void {
    const c = this.canvas()
    const win = new BrowserWindow({
      show: false,
      width: c.width,
      height: c.height,
      useContentSize: true,
      enableLargerThanScreen: true,
      paintWhenInitiallyHidden: true,
      skipTaskbar: true,
      fullscreenable: false,
      // No `frame: false`: on Linux a frameless window the size of the screen comes out 1 px smaller.
      backgroundColor: '#000000',
      title: 'Bridgecast web page',
      webPreferences: { ...PAGE_PREFERENCES, session: this.session(), backgroundThrottling: false }
    })
    const p: Page = {
      deckId,
      win,
      loaded: false,
      frameSeen: false,
      failed: null,
      status: 'loading',
      popups: new Set(),
      unresponsive: null,
      crashReload: null,
      autoName: false,
      sizeOk: true,
      cursor: 'default'
    }
    this.pages.set(deckId, p)
    this.fitSize(p)
    const wc = win.webContents
    // Its sound only reaches the audience through the outputs (tab capture taps it before the mute).
    wc.setAudioMuted(true)
    win.on('page-title-updated', (e) => e.preventDefault())
    // Never really fullscreen: the page already fills a canvas-sized viewport. HTML
    // full screen (Canva Present calls requestFullscreen) keeps the window hidden
    // and its content size at the canvas.
    const keepWindow = (): void => {
      if (win.isDestroyed()) return
      if (win.isFullScreen()) win.setFullScreen(false)
      if (win.isVisible()) win.hide()
      this.fitSize(p)
    }
    win.on('enter-full-screen', keepWindow)
    win.on('leave-full-screen', keepWindow)
    win.on('enter-html-full-screen', keepWindow)
    win.on('leave-html-full-screen', keepWindow)

    // Electron docs (webContents.setZoomMode, v45): the default mode keeps zoom per ORIGIN, so
    // two decks on one site would share a zoom; 'isolated' is per webContents and survives
    // navigation. Task 3 assumed the default mode; fixed here. The factor is still re-applied
    // after every main-frame navigation as a belt-and-braces step (it is a no-op when equal).
    wc.setZoomMode('isolated')
    wc.on('did-navigate', () => {
      wc.setZoomFactor(this.storedZoom(deckId))
      this.pushNav(p)
    })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => {
      if (isMainFrame) this.pushNav(p)
    })
    wc.on('did-start-loading', () => this.pushNav(p))
    wc.on('did-stop-loading', () => this.pushNav(p))
    wc.on('page-title-updated', () => this.pushNav(p))
    wc.on('cursor-changed', (_e, type) => {
      p.cursor = type
      this.pushNav(p)
    })

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      p.loaded = false
      p.failed = null
      this.updateStatus(p)
    })
    wc.on('did-finish-load', () => {
      p.loaded = true
      // A failed load can still finish (the error page): it keeps the error and the old snapshot.
      if (p.failed) return
      if (p.autoName) this.renameFromTitle(p)
      this.updateStatus(p)
      void this.snapshot(deckId)
    })
    wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
      if (!failLoadIsError(errorCode, isMainFrame)) return
      p.loaded = false
      p.failed = `Could not open ${webDomain(validatedURL || wc.getURL())}. Check the internet connection, then Reload.`
      this.updateStatus(p)
      this.hold(deckId)
    })
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[web] page renderer stopped (${details.reason}); reloading it`)
      p.loaded = false
      p.frameSeen = false
      p.failed = `Could not open ${webDomain(wc.getURL())}. Check the internet connection, then Reload.`
      this.updateStatus(p)
      this.hold(deckId)
      this.clearCrashReload(p)
      p.crashReload = setTimeout(() => {
        p.crashReload = null
        if (!win.isDestroyed()) wc.reload()
      }, CRASH_RELOAD_MS)
    })
    win.on('unresponsive', () => {
      if (p.unresponsive) return
      p.unresponsive = setTimeout(() => {
        p.unresponsive = null
        this.hold(deckId)
      }, UNRESPONSIVE_HOLD_MS)
    })
    win.on('responsive', () => {
      if (p.unresponsive) clearTimeout(p.unresponsive)
      p.unresponsive = null
    })

    this.guardContents(p, wc)
    win.on('closed', () => {
      this.clearTimers(p)
      for (const w of p.popups) if (!w.isDestroyed()) w.destroy()
      if (this.pages.get(deckId) === p) {
        this.pages.delete(deckId)
        this.coalescer.drop(deckId)
      }
    })
    this.onStatus(deckId, p.status, undefined, p.warning)
    this.load(p, url)
  }

  /** Navigation, popups and new windows of a page or one of its popups. */
  private guardContents(p: Page, wc: WebContents): void {
    // Main frame: web pages only. Subframes may also hold about:srcdoc, blob: and data:
    // documents (embeds, widgets); external protocols stay blocked everywhere.
    const block = (e: Electron.Event, url: string, isMainFrame: boolean): void => {
      if (!frameNavigationAllowed(url, isMainFrame)) e.preventDefault()
    }
    wc.on('will-navigate', (e) => block(e, e.url, true))
    wc.on('will-frame-navigate', (e) => block(e, e.url, e.isMainFrame))
    wc.on('will-redirect', (e) => block(e, e.url, e.isMainFrame))
    wc.setWindowOpenHandler((details) => {
      const action = popupAction(this.live(p.deckId), details.disposition, details.url)
      if (action === 'samePage') {
        // A link that wants a new tab: show it in this page, not in a stray window.
        void this.navigate(p.deckId, details.url).catch(() => undefined)
        return { action: 'deny' }
      }
      if (action === 'deny') return { action: 'deny' }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          ...this.popupBounds(),
          show: true,
          autoHideMenuBar: true,
          webPreferences: { ...PAGE_PREFERENCES, session: this.session() }
        }
      }
    })
    wc.on('did-create-window', (child) => {
      p.popups.add(child)
      child.on('closed', () => p.popups.delete(child))
      this.guardContents(p, child.webContents)
    })
  }

  /** A normal window centred on the operator window's display (never the HDMI display). */
  private popupBounds(): { x?: number; y?: number; width: number; height: number } {
    const width = 1000
    const height = 760
    const op = this.operatorWindow()
    if (!op || op.isDestroyed()) return { width, height }
    const area = screen.getDisplayMatching(op.getBounds()).workArea
    const w = Math.min(width, area.width)
    const h = Math.min(height, area.height)
    return {
      x: Math.round(area.x + (area.width - w) / 2),
      y: Math.round(area.y + (area.height - h) / 2),
      width: w,
      height: h
    }
  }

  private load(p: Page, url: string): void {
    if (!navigationAllowed(url)) return
    // A failed load is reported through did-fail-load; the promise must not go unhandled.
    p.win.webContents.loadURL(url).catch(() => {})
  }

  /** Content size = canvas; verified, since a window can be clamped to the screen. */
  private fitSize(p: Page): void {
    if (p.win.isDestroyed()) return
    const c = this.canvas()
    p.win.setContentSize(c.width, c.height)
    const size = p.win.getContentSize()
    const warning = pageSizeWarning(size, c)
    p.sizeOk = warning === undefined
    if (!p.sizeOk) console.warn(`[web] ${warning}`)
    if (warning !== p.warning) {
      p.warning = warning
      // Same channel as the load state: the operator sees the warning while it lasts.
      this.onStatus(p.deckId, p.status, p.failed ?? undefined, p.warning)
    }
  }

  private updateStatus(p: Page): void {
    const status: WebStatus = p.failed ? 'error' : p.loaded && p.frameSeen ? 'ready' : 'loading'
    if (status === p.status && status !== 'error') return
    p.status = status
    this.onStatus(p.deckId, status, p.failed ?? undefined, p.warning)
  }

  /** HOLD (only main sets it) when the page is on air; never ends by itself. */
  private hold(deckId: string): void {
    if (this.live(deckId)) this.state.setWebHold(true)
  }

  private renameFromTitle(p: Page): void {
    p.autoName = false
    const wc = p.win.webContents
    const name = webDeckName(wc.getTitle(), wc.getURL())
    const ev = this.lib.listEvents().find((e) => e.deckIds.includes(p.deckId))
    if (!ev) return
    try {
      this.lib.renameDeck(ev.id, p.deckId, name)
    } catch (err) {
      console.error('[web] deck could not be named after the page:', err)
    }
  }

  /** Stores a picture of the page as the deck's slide (thumbnail, poster, Up next). */
  private async snapshot(deckId: string): Promise<void> {
    for (let i = 0; i < SNAPSHOT_TRIES; i++) {
      const p = this.pages.get(deckId)
      if (!p || p.win.isDestroyed()) return
      try {
        const img = await p.win.webContents.capturePage()
        if (!img.isEmpty()) {
          const tmp = path.join(os.tmpdir(), `ppt-share-web-${randomUUID()}.png`)
          try {
            await fs.promises.writeFile(tmp, img.toPNG())
            this.lib.updateWebSnapshot(deckId, tmp)
          } finally {
            fs.rmSync(tmp, { force: true })
          }
          return
        }
      } catch {
        // No frame composited yet (UnknownVizError right after a load), or the deck is gone.
      }
      await new Promise((r) => setTimeout(r, SNAPSHOT_RETRY_MS))
    }
  }

  private clearCrashReload(p: Page): void {
    if (p.crashReload) clearTimeout(p.crashReload)
    p.crashReload = null
  }

  private clearTimers(p: Page): void {
    this.clearCrashReload(p)
    if (p.unresponsive) clearTimeout(p.unresponsive)
    p.unresponsive = null
  }

  private close(deckId: string): void {
    const p = this.pages.get(deckId)
    if (!p) return
    this.pages.delete(deckId)
    this.interact.clear(deckId)
    this.coalescer.drop(deckId)
    this.clearTimers(p)
    for (const w of p.popups) if (!w.isDestroyed()) w.destroy()
    if (!p.win.isDestroyed()) p.win.destroy()
  }
}
