import { BrowserWindow, screen, session, type Session, type WebContents } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { Library } from '../library'
import type { AppState } from '../state'
import type { Canvas } from '../../shared/canvas'
import type { DeckMeta } from '../../shared/types'
import { webDomain, type WebStatus } from '../../shared/web'
import {
  applyWebSession,
  electronKeyName,
  navigationAllowed,
  popupAllowed,
  validatePrepareInput
} from './policy'
import { failLoadIsError, syncPlan, webDeckName } from './host-rules'

export type { WebStatus }

/** The one browser profile of every web deck (sign-ins persist across restarts). */
export const WEB_PARTITION = 'persist:web'
/** A page that stays unresponsive this long while on air triggers HOLD. */
const UNRESPONSIVE_HOLD_MS = 5000
/** A crashed page is reloaded behind the scenes after this delay. */
const CRASH_RELOAD_MS = 1000
/** capturePage fails right after a load (no frame composited yet): retry this often. */
const SNAPSHOT_TRIES = 4
const SNAPSHOT_RETRY_MS = 500

export const SIGN_OUT_LIVE = 'Take another deck first, then sign out.'
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
  private ses: Session | null = null
  /** The web deck on air at the last syncEvent, to snapshot it when it leaves. */
  private onAir: string | null = null
  private closed = false

  constructor(
    private lib: Library,
    private state: AppState,
    private canvas: () => Canvas,
    private onStatus: (deckId: string, s: WebStatus, message?: string) => void,
    /** Where popups (sign-in windows) open: the operator window's display. */
    private operatorWindow: () => BrowserWindow | null = () => null,
    /** The dev server URL in development: its origin counts as an app window for tab capture. */
    private devUrl?: string
  ) {}

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
    const p = this.pages.get(deckId)
    return !!p && p.status === 'ready'
  }

  /** Every open page's current status. */
  statuses(): { deckId: string; status: WebStatus; message?: string }[] {
    return [...this.pages.values()].map((p) =>
      p.failed
        ? { deckId: p.deckId, status: p.status, message: p.failed }
        : {
            deckId: p.deckId,
            status: p.status
          }
    )
  }

  reload(deckId: string): void {
    const p = this.page(deckId)
    this.clearCrashReload(p)
    p.win.webContents.reload()
  }

  navigate(deckId: string, url: string): void {
    const p = this.page(deckId)
    this.clearCrashReload(p)
    this.load(p, url)
  }

  back(deckId: string): void {
    const h = this.page(deckId).win.webContents.navigationHistory
    if (h.canGoBack()) h.goBack()
  }

  forward(deckId: string): void {
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
      frozen: this.state.state.frozen
    })
    if (!ev) return false
    this.input(deckId, ev)
    return true
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
      title: 'PPT Share web page',
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
      sizeOk: true
    }
    this.pages.set(deckId, p)
    this.fitSize(p)
    const wc = win.webContents
    // Its sound only reaches the audience through the outputs (tab capture taps it before the mute).
    wc.setAudioMuted(true)
    win.on('page-title-updated', (e) => e.preventDefault())
    // Never really fullscreen: the page already fills a canvas-sized viewport.
    win.on('enter-full-screen', () => win.setFullScreen(false))

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
      if (this.pages.get(deckId) === p) this.pages.delete(deckId)
    })
    this.onStatus(deckId, p.status)
    this.load(p, url)
  }

  /** Navigation, popups and new windows of a page or one of its popups. */
  private guardContents(p: Page, wc: WebContents): void {
    const block = (e: Electron.Event, url: string): void => {
      if (!navigationAllowed(url)) e.preventDefault()
    }
    wc.on('will-navigate', (e) => block(e, e.url))
    wc.on('will-frame-navigate', (e) => block(e, e.url))
    wc.on('will-redirect', (e) => block(e, e.url))
    wc.setWindowOpenHandler((details) => {
      if (!popupAllowed(this.live(p.deckId)) || !navigationAllowed(details.url)) {
        return { action: 'deny' }
      }
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
    const [w, h] = p.win.getContentSize()
    p.sizeOk = w === c.width && h === c.height
    if (!p.sizeOk) {
      console.warn(`[web] page window is ${w}x${h}, the canvas is ${c.width}x${c.height}`)
    }
  }

  private updateStatus(p: Page): void {
    const status: WebStatus = p.failed ? 'error' : p.loaded && p.frameSeen ? 'ready' : 'loading'
    if (status === p.status && status !== 'error') return
    p.status = status
    this.onStatus(p.deckId, status, p.failed ?? undefined)
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
    this.clearTimers(p)
    for (const w of p.popups) if (!w.isDestroyed()) w.destroy()
    if (!p.win.isDestroyed()) p.win.destroy()
  }
}
