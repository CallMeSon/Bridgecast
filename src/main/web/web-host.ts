import type { WebContents } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Library } from '../library'
import type { AppState } from '../state'
import type { Canvas } from '../../shared/canvas'
import type { DeckMeta } from '../../shared/types'
import { ZOOM_LIVE_REFUSED, type WebNavState, type WebStatus } from '../../shared/web'
import { validatePrepareInput, zoomAllowed } from './policy'
import {
  holdBeforeNavigate,
  NavCoalescer,
  syncPlan,
  verificationWall,
  webDeckName,
  WEB_SLOW_WARNING,
  WEB_STALL_WARNING
} from './host-rules'
import { InteractSwitches } from './interact'
import type { CaptureSource, PageBackend } from './page-backend'
import { webLog } from './web-log'

export type { WebStatus }

/** capturePage/thumbnail fails right after a load (no frame composited yet): retry this often. */
const SNAPSHOT_TRIES = 4
const SNAPSHOT_RETRY_MS = 500
/** Without a way to hear back from the outputs, HOLD before navigating waits this long. */
const HOLD_SETTLE_MS = 300
/** A loaded page with no capture frame for this long is reported to the operator. */
const STALL_MS = 8000

const SIGN_OUT_LIVE = 'Take another deck first, then sign out.'
const INTERACT_NOT_LIVE =
  'Interact works only while the web page is on air. Take the deck first, then turn Interact on.'
const NOT_OPEN = 'The web page is not open. Reload the deck, then try again.'

interface Page {
  deckId: string
  /** The main frame finished loading (and has not started another document since). */
  loaded: boolean
  /** An app window received a frame of this page's capture (ready gate). */
  frameSeen: boolean
  /** Last main-frame load failed or the page stopped. */
  failed: string | null
  status: WebStatus
  /** Rename the deck after the page title on the next load (added without a name). */
  autoName: boolean
  /** Operator warning about the page window (its size), sent with its status. */
  warning?: string
  /** Sign-in profile of the page (`default` unless the deck has its own). */
  profile: string
  /** Last navigation state the backend reported. */
  nav?: WebNavState
}

/**
 * One page per web deck of the open event (plus the page on air), through a
 * `PageBackend`: Electron's hidden `BrowserWindow` everywhere, or the Windows
 * `web-bridge` WebView2 helper. This class keeps the operator-facing rules — the ready
 * gate, HOLD, status, Interact, snapshots — and delegates everything that touches the
 * page itself. The pure decisions live in host-rules.ts and policy.ts.
 */
export class WebHost {
  private pages = new Map<string, Page>()
  /** Interact per deck (see interact.ts); the owner is the window that turned it on. */
  private interact = new InteractSwitches<WebContents>()
  /** Owner windows whose close and navigation already drop their switches. */
  private watched = new WeakSet<WebContents>()
  /** The web deck on air at the last syncEvent, to snapshot it when it leaves. */
  private onAir: string | null = null
  private closed = false
  /** Decks whose HOLD before navigating still waits for the outputs to pause. */
  private holding = new Map<string, Promise<void>>()
  /** Per deck: the timer that reports a loaded page with no capture frame. */
  private stalls = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * HOLD before navigating a live page waits for this: the outputs report that their
   * stream is paused (`web:held`), or a timeout. Set by main.
   */
  waitHeld: (deckId: string) => Promise<unknown> = () =>
    new Promise((r) => setTimeout(r, HOLD_SETTLE_MS))
  private coalescer: NavCoalescer

  constructor(
    private lib: Library,
    private state: AppState,
    private canvas: () => Canvas,
    private onStatus: (deckId: string, s: WebStatus, message?: string, warning?: string) => void,
    private backend: PageBackend,
    /** Navigation state of a page changed (coalesced; `loading` changes go at once). */
    onNav: (s: WebNavState) => void = () => {}
  ) {
    this.coalescer = new NavCoalescer(
      onNav,
      (fn, ms) => setTimeout(fn, ms),
      (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    )
    this.wire(this.backend)
  }

  private wire(backend: PageBackend): void {
    backend.setEvents({
      nav: (s) => this.onBackendNav(s),
      loaded: (deckId, info) => this.onLoaded(deckId, info),
      loadFailed: (deckId, message) => this.onLoadFailed(deckId, message),
      crashed: (deckId, message) => this.onCrashed(deckId, message),
      hung: (deckId) => {
        webLog(`${deckId} page hung; HOLD`)
        this.hold(deckId)
      },
      warning: (deckId, warning) => this.onWarning(deckId, warning),
      closed: (deckId) => this.onPageClosed(deckId)
    })
  }

  /**
   * Replaces the page backend (the web helper gave up, or the app changed its mind):
   * every open page is opened again on the new one. The audience sees HOLD or the
   * snapshot while the new windows come up, never black.
   */
  async switchBackend(next: PageBackend): Promise<void> {
    if (this.closed) return
    const old = this.backend
    this.backend = next
    this.wire(next)
    old.dispose()
    for (const p of [...this.pages.values()]) {
      p.loaded = false
      p.failed = null
      p.frameSeen = false
      p.status = 'loading'
      this.onStatus(p.deckId, p.status, undefined, p.warning)
      try {
        await next.open(p.deckId, {
          url: p.nav?.url || this.deckUrl(p.deckId),
          canvas: this.canvas(),
          zoom: this.storedZoom(p.deckId),
          profile: p.profile,
          live: this.live(p.deckId)
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        this.onLoadFailed(p.deckId, message)
      }
    }
  }

  /** The deck's saved address (for reopening after a backend switch). */
  private deckUrl(deckId: string): string {
    try {
      return this.lib.getDeck(deckId).web?.url ?? ''
    } catch {
      return ''
    }
  }

  /** True for a web deck page (only the Electron backend has Electron page windows). */
  owns(wc: WebContents): boolean {
    return this.backend.owns?.(wc) ?? false
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
    for (const id of plan.close) webLog(`${id} closing (not in the open event)`)
    // The helper refuses new windows for the deck on air; keep it told after every change.
    for (const p of this.pages.values()) this.backend.setLive?.(p.deckId, this.live(p.deckId))
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
    this.page(deckId)
    await this.backend.reload(deckId)
  }

  async navigate(deckId: string, url: string): Promise<void> {
    this.page(deckId)
    await this.holdFirst(deckId)
    this.page(deckId)
    await this.backend.load(deckId, url)
  }

  /** Stops a load in progress. Allowed on air: it only ends a load. */
  stop(deckId: string): void {
    this.page(deckId)
    this.backend.stop(deckId)
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
    this.page(deckId)
    if (!zoomAllowed({ live: this.live(deckId), frozen: this.state.state.frozen })) {
      throw new Error(ZOOM_LIVE_REFUSED)
    }
    const ev = this.lib.listEvents().find((e) => e.deckIds.includes(deckId))
    if (!ev) throw new Error(NOT_OPEN)
    const deck = this.lib.setWebZoom(ev.id, deckId, zoom)
    void this.backend.setZoom(deckId, zoom).catch((e: unknown) => {
      console.warn('[web] page zoom not applied:', e instanceof Error ? e.message : e)
    })
    const p = this.pages.get(deckId)
    if (p?.nav) this.coalescer.push({ ...p.nav, zoom })
    return deck
  }

  /** Navigation state of every open page. */
  navStates(): WebNavState[] {
    return [...this.pages.values()]
      .map((p) => p.nav)
      .filter((s): s is WebNavState => !!s)
  }

  async back(deckId: string): Promise<void> {
    const p = this.page(deckId)
    // Nothing to go back to: a HOLD for a no-op would freeze the output for nothing.
    if (!p.nav?.canGoBack) return
    await this.holdFirst(deckId)
    await this.backend.back(deckId)
  }

  async forward(deckId: string): Promise<void> {
    const p = this.page(deckId)
    if (!p.nav?.canGoForward) return
    await this.holdFirst(deckId)
    await this.backend.forward(deckId)
  }

  /** Next/Prev on air: exactly one keyDown and one keyUp (no char, no repeat). */
  key(deckId: string, key: 'ArrowRight' | 'ArrowLeft'): void {
    if (!this.pages.has(deckId)) return
    this.backend.key(deckId, key)
  }

  /** Sends one already validated input event to the page, without focusing it. */
  input(deckId: string, ev: Electron.InputEvent): void {
    if (!this.pages.has(deckId)) return
    this.backend.input(deckId, ev)
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
    if (!this.pages.has(deckId)) throw new Error(NOT_OPEN)
    if (on && !this.live(deckId)) throw new Error(INTERACT_NOT_LIVE)
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

  /** Capture id (and kind) of the page for `requester`. */
  async sourceIdFor(deckId: string, requester: WebContents): Promise<CaptureSource> {
    const p = this.pages.get(deckId)
    if (!p) throw new Error(NOT_OPEN)
    try {
      return await this.backend.captureSource(deckId, requester)
    } catch (e) {
      // The renderer retries; the log says why no frame is coming.
      webLog(`${deckId} capture source failed: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
  }

  /** An app window received a captured frame of the page (ready gate). */
  frameSeen(deckId: string): void {
    const p = this.pages.get(deckId)
    if (!p || p.frameSeen) return
    p.frameSeen = true
    this.clearStall(deckId)
    // The capture works: the stall warning (if any) no longer applies.
    if (p.warning === WEB_STALL_WARNING || p.warning === WEB_SLOW_WARNING) {
      p.warning = undefined
      webLog(`${deckId} capture frame received; warning cleared`)
    }
    this.updateStatus(p)
  }

  /** An output's capture track of the page ended: HOLD while the deck is on air. */
  captureEnded(deckId: string): void {
    this.hold(deckId)
  }

  /** The canvas changed: every page window follows it. */
  resize(): void {
    this.backend.resize(this.canvas())
  }

  /** The named pipe carrying a page's sound (web-bridge only). */
  audioPipe(deckId: string): string | null {
    return this.backend.audioPipe?.(deckId) ?? null
  }

  /** A page's sound pipe may have changed (opened with its page, or closed). Set by main. */
  onAudioChanged: (deckId: string) => void = () => {}

  /** Mutes one page's own playback (only the deck on air is heard on this PC). */
  setMuted(deckId: string, muted: boolean): void {
    if (!this.pages.has(deckId)) return
    this.backend.setMuted?.(deckId, muted)
  }

  /**
   * Clears every site's cookies, storage and cache and reloads the pages.
   * Refused while a web deck is on air.
   */
  async signOut(): Promise<void> {
    if (this.state.state.shown?.web) throw new Error(SIGN_OUT_LIVE)
    const profiles = [...this.pages.values()].map((p) => p.profile)
    for (const p of this.pages.values()) {
      p.loaded = false
      p.failed = null
      this.updateStatus(p)
    }
    await this.backend.signOut(profiles.length > 0 ? profiles : ['default'])
  }

  /** Quit: every page and popup goes, no reload timers remain. */
  shutdown(): void {
    this.closed = true
    this.pages.clear()
    this.backend.dispose()
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
      const extra = (await this.backend.debug?.(p.deckId)) ?? {}
      const contentSize = Array.isArray(extra.contentSize)
        ? (extra.contentSize as number[])
        : [this.canvas().width, this.canvas().height]
      out[p.deckId] = {
        status: p.status,
        ...(typeof extra.counter === 'number' ? { counter: extra.counter } : {}),
        webHold: this.live(p.deckId) && this.state.state.webHold,
        windowOpen: extra.windowOpen === true || (this.backend.popups?.(p.deckId) ?? 0) > 0,
        frameSeen: p.frameSeen,
        contentSize,
        sizeOk: extra.sizeOk === true || (extra.sizeOk === undefined && !p.warning),
        url: typeof extra.url === 'string' ? extra.url : (p.nav?.url ?? '')
      }
    }
    return out
  }

  // ---- backend events ----

  private onBackendNav(s: WebNavState): void {
    const p = this.pages.get(s.deckId)
    if (!p) return
    const previous = p.nav?.url
    p.nav = s
    if (s.url !== previous) webLog(`${s.deckId} nav ${s.url} (loading=${s.loading})`)
    // A new main-frame document started (Reload, a new URL, history, or the backend's own
    // reload after a crash): the previous load and failure no longer describe the page.
    if (s.loading && s.url !== '') {
      const changed = p.loaded || p.failed !== null
      p.loaded = false
      p.failed = null
      if (changed) this.updateStatus(p)
    }
    // Google's "unusual traffic" wall is a real page with a real frame: say why the search
    // result is not there instead of leaving the operator with a bare Loading chip (the
    // wall page often never reports the load as finished).
    const wall = verificationWall(s.url)
    if (wall && p.failed !== wall) {
      p.failed = wall
      this.updateStatus(p)
      this.hold(s.deckId)
    }
    this.coalescer.push(s)
  }

  /** Report a page that loaded but never gives a capture frame (the output shows a snapshot). */
  private armStall(deckId: string): void {
    if (this.stalls.has(deckId)) return
    const timer = setTimeout(() => {
      this.stalls.delete(deckId)
      const p = this.pages.get(deckId)
      if (this.closed || !p || p.frameSeen) return
      const warning = p.loaded ? WEB_STALL_WARNING : WEB_SLOW_WARNING
      webLog(
        `${deckId} ${p.loaded ? 'stall' : 'slow'}: ${warning} (${p.nav?.url ?? ''})`
      )
      if (p.warning !== warning) {
        p.warning = warning
        this.onStatus(p.deckId, p.status, p.failed ?? undefined, p.warning)
      }
      // Keep watching: the warning clears when the page loads and a frame arrives.
      this.armStall(deckId)
    }, STALL_MS)
    timer.unref?.()
    this.stalls.set(deckId, timer)
  }

  private clearStall(deckId: string): void {
    const timer = this.stalls.get(deckId)
    if (timer) clearTimeout(timer)
    this.stalls.delete(deckId)
  }

  private onLoaded(deckId: string, info: { title: string; url: string }): void {
    const p = this.pages.get(deckId)
    if (!p) return
    p.loaded = true
    // A failed load can still finish (the error page): it keeps the error and the old snapshot.
    if (p.failed) return
    webLog(`${deckId} loaded ${info.url} "${info.title}"`)
    if (p.autoName) this.renameFromTitle(p, info.title, info.url)
    this.updateStatus(p)
    this.armStall(deckId)
    void this.snapshot(deckId)
  }

  private onLoadFailed(deckId: string, message: string): void {
    const p = this.pages.get(deckId)
    if (!p) return
    p.loaded = false
    p.failed = message
    webLog(`${deckId} load failed: ${message}`)
    this.updateStatus(p)
    this.hold(deckId)
  }

  private onCrashed(deckId: string, message: string): void {
    const p = this.pages.get(deckId)
    if (!p) return
    p.loaded = false
    p.frameSeen = false
    p.failed = message
    webLog(`${deckId} page stopped: ${message}`)
    this.updateStatus(p)
    this.hold(deckId)
  }

  private onWarning(deckId: string, warning: string | undefined): void {
    const p = this.pages.get(deckId)
    if (!p || warning === p.warning) return
    p.warning = warning
    this.onStatus(p.deckId, p.status, p.failed ?? undefined, p.warning)
  }

  private onPageClosed(deckId: string): void {
    const p = this.pages.get(deckId)
    if (!p) return
    this.clearStall(deckId)
    this.pages.delete(deckId)
    this.interact.clear(deckId)
    this.coalescer.drop(deckId)
    webLog(`${deckId} page closed by the backend`)
  }

  // ---- page lifecycle ----

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
    if (!p) throw new Error(NOT_OPEN)
    return p
  }

  private open(deckId: string, url: string): void {
    if (this.closed) return
    const p: Page = {
      deckId,
      loaded: false,
      frameSeen: false,
      failed: null,
      status: 'loading',
      autoName: false,
      profile: this.profileOf(deckId)
    }
    this.pages.set(deckId, p)
    webLog(`${deckId} opening ${url} (profile ${p.profile}, canvas ${this.canvas().width}x${this.canvas().height})`)
    this.onStatus(deckId, p.status, undefined, p.warning)
    this.armStall(deckId)
    void this.backend
      .open(deckId, {
        url,
        canvas: this.canvas(),
        zoom: this.storedZoom(deckId),
        profile: p.profile,
        live: this.live(deckId)
      })
      .catch((e: unknown) => {
        if (this.closed || this.pages.get(deckId) !== p) return
        const message = e instanceof Error ? e.message : String(e)
        this.onLoadFailed(deckId, message)
      })
      .then(() => {
        if (this.closed || this.pages.get(deckId) !== p) return
        this.onAudioChanged(deckId)
      })
  }

  private profileOf(deckId: string): string {
    try {
      return this.lib.getDeck(deckId).web?.profile ?? 'default'
    } catch {
      return 'default'
    }
  }

  private storedZoom(deckId: string): number {
    try {
      return this.lib.getDeck(deckId).web?.zoom ?? 1
    } catch {
      return 1
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

  private renameFromTitle(p: Page, title: string, url: string): void {
    p.autoName = false
    const name = webDeckName(title, url)
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
      if (!this.pages.has(deckId)) return
      try {
        const png = await this.backend.snapshot(deckId)
        if (png) {
          const tmp = path.join(os.tmpdir(), `ppt-share-web-${randomUUID()}.png`)
          try {
            await fs.promises.writeFile(tmp, png)
            this.lib.updateWebSnapshot(deckId, tmp)
          } finally {
            fs.rmSync(tmp, { force: true })
          }
          return
        }
      } catch {
        // No frame composited yet, or the deck is gone.
      }
      await new Promise((r) => setTimeout(r, SNAPSHOT_RETRY_MS))
    }
  }

  private close(deckId: string): void {
    const p = this.pages.get(deckId)
    if (!p) return
    this.clearStall(deckId)
    this.pages.delete(deckId)
    this.interact.clear(deckId)
    this.coalescer.drop(deckId)
    this.backend.close(deckId)
  }
}
