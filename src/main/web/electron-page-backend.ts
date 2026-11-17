import { BrowserWindow, screen, session, type Session, type WebContents } from 'electron'
import {
  applyWebSession,
  electronKeyName,
  frameNavigationAllowed,
  navigationAllowed,
  popupAction
} from './policy'
import { startAdBlock } from './adblock'
import type { PageBackend, PageBackendEvents, PageSize } from './page-backend'
import { failLoadIsError, pageSizeWarning } from './host-rules'
import { webDomain, type WebNavState } from '../../shared/web'

/** The one browser profile of every web deck (sign-ins persist across restarts). */
const WEB_PARTITION = 'persist:web'
/** A page that stays unresponsive this long while on air triggers HOLD. */
const UNRESPONSIVE_HOLD_MS = 5000
/** A crashed page is reloaded behind the scenes after this delay. */
const CRASH_RELOAD_MS = 1000

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
  popups: Set<BrowserWindow>
  unresponsive: ReturnType<typeof setTimeout> | null
  crashReload: ReturnType<typeof setTimeout> | null
  /** The content size matches the canvas (a window can be clamped to the screen). */
  sizeOk: boolean
  /** Operator warning about the page window (its size), sent with its status. */
  warning?: string
  /** Last cursor type of the page (Electron cursor type string). */
  cursor: string
  zoom: number
  /** The canvas last applied (a resize applies it to every page). */
  lastCanvas?: PageSize
}

interface ElectronPageBackendOptions {
  /** Where popups (sign-in windows) open: the operator window's display. */
  operatorWindow: () => BrowserWindow | null
  /** True while the deck is on air (a page on air may not open a window). */
  isLive: (deckId: string) => boolean
  /** The dev server URL in development: its origin counts as an app window for tab capture. */
  devUrl?: string
}

/**
 * Web deck pages in hidden Electron `BrowserWindow`s (the fallback everywhere, and the
 * only backend on Linux). Outputs and previews capture a page with
 * `getMediaSourceId` + `chromeMediaSource: 'tab'`.
 */
export class ElectronPageBackend implements PageBackend {
  private pages = new Map<string, Page>()
  private events: PageBackendEvents | null = null
  private ses: Session | null = null
  private closed = false

  constructor(private opts: ElectronPageBackendOptions) {}

  setEvents(events: PageBackendEvents): void {
    this.events = events
  }

  private session(): Session {
    if (!this.ses) {
      this.ses = session.fromPartition(WEB_PARTITION)
      applyWebSession(this.ses, this.ses.getUserAgent(), this.opts.devUrl)
      startAdBlock(this.ses)
    }
    return this.ses
  }

  owns(wc: WebContents): boolean {
    return this.ses !== null && wc.session === this.ses
  }

  async open(
    deckId: string,
    o: { url: string; canvas: PageSize; zoom: number; profile: string }
  ): Promise<void> {
    if (this.closed) return
    const c = o.canvas
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
      popups: new Set(),
      unresponsive: null,
      crashReload: null,
      sizeOk: true,
      cursor: 'default',
      zoom: o.zoom
    }
    this.pages.set(deckId, p)
    this.fitSize(p, c)
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
    // navigation. The factor is still re-applied after every main-frame navigation.
    wc.setZoomMode('isolated')
    wc.on('did-navigate', () => {
      wc.setZoomFactor(p.zoom)
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
      this.pushNav(p)
    })
    wc.on('did-finish-load', () => {
      this.pushNav(p)
      this.events?.loaded(deckId, { title: wc.getTitle(), url: wc.getURL() })
    })
    wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
      if (!failLoadIsError(errorCode, isMainFrame)) return
      this.events?.loadFailed(
        deckId,
        `Could not open ${webDomain(validatedURL || wc.getURL())}. Check the internet connection, then Reload.`
      )
    })
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[web] page renderer stopped (${details.reason}); reloading it`)
      p.cursor = 'default'
      this.events?.crashed(
        deckId,
        `Could not open ${webDomain(wc.getURL())}. Check the internet connection, then Reload.`
      )
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
        this.events?.hung(deckId)
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
      if (this.pages.get(deckId) === p) this.pages.delete(deckId)
      this.events?.closed(deckId)
    })
    this.load(deckId, o.url)
  }

  async load(deckId: string, url: string): Promise<void> {
    const p = this.page(deckId)
    if (!p || !navigationAllowed(url)) return
    this.clearCrashReload(p)
    // A failed load is reported through did-fail-load; the promise must not go unhandled.
    p.win.webContents.loadURL(url).catch(() => {})
  }

  async reload(deckId: string): Promise<void> {
    const p = this.page(deckId)
    if (!p) return
    this.clearCrashReload(p)
    p.win.webContents.reload()
  }

  async back(deckId: string): Promise<void> {
    const p = this.page(deckId)
    if (!p) return
    const h = p.win.webContents.navigationHistory
    if (h.canGoBack()) h.goBack()
  }

  async forward(deckId: string): Promise<void> {
    const p = this.page(deckId)
    if (!p) return
    const h = p.win.webContents.navigationHistory
    if (h.canGoForward()) h.goForward()
  }

  stop(deckId: string): void {
    this.page(deckId)?.win.webContents.stop()
  }

  /**
   * Next/Prev on air: exactly one keyDown and one keyUp (no char, no repeat). The
   * hidden page is never focused: that could take the keyboard away from the
   * operator window, and sendInputEvent reaches the page without focus.
   */
  key(deckId: string, key: 'ArrowRight' | 'ArrowLeft'): void {
    const p = this.page(deckId)
    if (!p) return
    const wc = p.win.webContents
    const keyCode = electronKeyName(key)
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
  }

  input(deckId: string, ev: Electron.InputEvent): void {
    const p = this.page(deckId)
    if (!p) return
    p.win.webContents.sendInputEvent(ev as Electron.MouseInputEvent)
  }

  async setZoom(deckId: string, zoom: number): Promise<void> {
    const p = this.page(deckId)
    if (!p) return
    p.zoom = zoom
    p.win.webContents.setZoomFactor(zoom)
    this.pushNav(p)
  }

  resize(canvas: PageSize): void {
    for (const p of this.pages.values()) this.fitSize(p, canvas)
  }

  async captureSource(deckId: string, requester: unknown): Promise<{ id: string; kind: 'tab' }> {
    const p = this.page(deckId)
    if (!p) throw new Error('The web page is not open. Reload the deck, then try again.')
    return { id: p.win.webContents.getMediaSourceId(requester as WebContents), kind: 'tab' }
  }

  async snapshot(deckId: string): Promise<Buffer | null> {
    const p = this.page(deckId)
    if (!p) return null
    try {
      const img = await p.win.webContents.capturePage()
      return img.isEmpty() ? null : img.toPNG()
    } catch {
      // No frame composited yet (UnknownVizError right after a load), or the deck is gone.
      return null
    }
  }

  popups(deckId: string): number {
    const p = this.page(deckId)
    return p ? [...p.popups].filter((w) => !w.isDestroyed()).length : 0
  }

  async debug(deckId: string): Promise<Record<string, unknown> | null> {
    const p = this.page(deckId)
    if (!p) return null
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
    if (p.win.isDestroyed()) return null
    return {
      ...(counter === undefined ? {} : { counter }),
      windowOpen: this.popups(deckId) > 0,
      contentSize: p.win.getContentSize(),
      sizeOk: p.sizeOk,
      url: wc.getURL()
    }
  }

  /** Clears every site's cookies, storage and cache and reloads the pages (one profile). */
  async signOut(): Promise<void> {
    const ses = this.session()
    await ses.clearStorageData()
    await ses.clearCache()
    for (const p of this.pages.values()) {
      for (const w of p.popups) if (!w.isDestroyed()) w.destroy()
      if (!p.win.isDestroyed()) p.win.webContents.reload()
    }
  }

  close(deckId: string): void {
    const p = this.pages.get(deckId)
    if (!p) return
    this.pages.delete(deckId)
    this.clearTimers(p)
    for (const w of p.popups) if (!w.isDestroyed()) w.destroy()
    if (!p.win.isDestroyed()) p.win.destroy()
  }

  dispose(): void {
    this.closed = true
    for (const id of [...this.pages.keys()]) this.close(id)
  }

  private page(deckId: string): Page | null {
    const p = this.pages.get(deckId)
    return !p || p.win.isDestroyed() ? null : p
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
      zoom: p.zoom,
      cursor: p.cursor
    }
  }

  private pushNav(p: Page): void {
    if (this.closed || p.win.isDestroyed()) return
    this.events?.nav(this.navState(p))
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
      const action = popupAction(this.opts.isLive(p.deckId), details.disposition, details.url)
      if (action === 'samePage') {
        // A link that wants a new tab: show it in this page, not in a stray window.
        void this.load(p.deckId, details.url)
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
    const op = this.opts.operatorWindow()
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

  /** Content size = canvas; verified, since a window can be clamped to the screen. */
  private fitSize(p: Page, canvas?: PageSize): void {
    if (p.win.isDestroyed()) return
    const c = canvas ?? p.lastCanvas
    if (!c) return
    p.lastCanvas = c
    p.win.setContentSize(c.width, c.height)
    const size = p.win.getContentSize()
    const warning = pageSizeWarning(size, c)
    p.sizeOk = warning === undefined
    if (!p.sizeOk) console.warn(`[web] ${warning}`)
    if (warning !== p.warning) {
      p.warning = warning
      this.events?.warning(p.deckId, warning)
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
}
