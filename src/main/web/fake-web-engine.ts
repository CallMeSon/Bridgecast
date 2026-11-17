import type { Canvas } from '../../shared/canvas'
import type { PrepareInput, WebNavState, WebStatus } from '../../shared/web'
import type { WebEngineStatus, WebOpenOptions, WebPageEngine } from './web-engine'

/**
 * In-memory `WebPageEngine` for tests and the `PPT_ENGINE_FAKE=1` run: no WebView2, no
 * helper process. Scripted events let a test drive a crash, a page status or a hang.
 */
export class FakeWebEngine implements WebPageEngine {
  /** What `open` was asked for, per deck. */
  readonly opened = new Map<string, WebOpenOptions>()
  readonly inputs: { deckId: string; ev: PrepareInput }[] = []
  readonly navs: WebNavState[] = []
  readonly statuses: WebEngineStatus[] = []
  readonly closed: string[] = []
  readonly signedOut: string[] = []
  readonly muted = new Map<string, boolean>()
  readonly live = new Map<string, boolean>()
  readonly stopped: string[] = []
  readonly sizes = new Map<string, Canvas>()
  /** False while the "helper" is down: calls reject like the real engine after an exit. */
  alive = true
  /** When set, `ping` never answers (a hung helper). */
  hung = false
  /** When set, `ping` rejects (the supervisor treats it as a hang). */
  pingFails = false
  get running(): boolean {
    return this.alive
  }
  private navCbs: ((s: WebNavState) => void)[] = []
  private statusCbs: ((s: WebEngineStatus) => void)[] = []
  private crashCbs: ((deckId: string) => void)[] = []
  private hungCbs: ((deckId: string) => void)[] = []
  private exitCbs: (() => void)[] = []

  on(ev: 'nav', cb: (s: WebNavState) => void): void
  on(ev: 'status', cb: (s: WebEngineStatus) => void): void
  on(ev: 'crashed', cb: (deckId: string) => void): void
  on(ev: 'hung', cb: (deckId: string) => void): void
  on(ev: 'exited', cb: () => void): void
  on(ev: 'nav' | 'status' | 'crashed' | 'hung' | 'exited', cb: never): void {
    if (ev === 'nav') this.navCbs.push(cb)
    else if (ev === 'status') this.statusCbs.push(cb)
    else if (ev === 'crashed') this.crashCbs.push(cb)
    else if (ev === 'hung') this.hungCbs.push(cb)
    else this.exitCbs.push(cb)
  }

  private guard(): void {
    if (!this.alive) throw new Error('The web page helper stopped.')
  }

  async open(
    deckId: string,
    o: WebOpenOptions
  ): Promise<{ windowId: string; audioPipe: string | null }> {
    this.guard()
    this.opened.set(deckId, o)
    this.sizes.set(deckId, o.canvas)
    // A real helper reports navigation starting, then the load, like WebView2.
    setTimeout(() => {
      this.emitNav(this.navOf(deckId, o.url, true, o.zoom))
      this.emitStatus(deckId, 'ready')
      this.emitNav(this.navOf(deckId, o.url, false, o.zoom))
    }, 0)
    return { windowId: `fake-${deckId}`, audioPipe: null }
  }

  private navOf(deckId: string, url: string, loading: boolean, zoom = 1): WebNavState {
    return {
      deckId,
      url,
      title: 'Bridge Page',
      canGoBack: false,
      canGoForward: false,
      loading,
      zoom,
      cursor: 'default'
    }
  }

  async navigate(deckId: string, url: string): Promise<void> {
    this.guard()
    const o = this.opened.get(deckId)
    if (o) this.opened.set(deckId, { ...o, url })
    setTimeout(() => {
      this.emitNav(this.navOf(deckId, url, true, o?.zoom))
      this.emitStatus(deckId, 'ready')
      this.emitNav(this.navOf(deckId, url, false, o?.zoom))
    }, 0)
  }

  async reload(): Promise<void> {
    this.guard()
  }

  stop(deckId: string): void {
    this.stopped.push(deckId)
  }

  setLive(deckId: string, live: boolean): void {
    this.live.set(deckId, live)
  }

  async back(): Promise<void> {
    this.guard()
  }

  async forward(): Promise<void> {
    this.guard()
  }

  async setZoom(deckId: string, zoom: number): Promise<void> {
    this.guard()
    const o = this.opened.get(deckId)
    if (o) this.opened.set(deckId, { ...o, zoom })
  }

  async resize(deckId: string, canvas: Canvas): Promise<void> {
    this.guard()
    this.sizes.set(deckId, canvas)
  }

  input(deckId: string, ev: PrepareInput): void {
    if (!this.alive) return
    this.inputs.push({ deckId, ev })
  }

  async setMuted(deckId: string, muted: boolean): Promise<void> {
    this.muted.set(deckId, muted)
  }

  async signOut(profile: string): Promise<void> {
    this.signedOut.push(profile)
  }

  async close(deckId: string): Promise<void> {
    this.closed.push(deckId)
    this.opened.delete(deckId)
    this.sizes.delete(deckId)
  }

  async ping(): Promise<void> {
    if (this.hung) return new Promise(() => undefined)
    if (this.pingFails) throw new Error('ping timeout')
    this.guard()
  }

  async shutdown(): Promise<void> {
    this.alive = false
  }

  // ---- scripted events for tests ----

  emitNav(s: WebNavState): void {
    this.navs.push(s)
    for (const cb of this.navCbs) cb(s)
  }

  emitStatus(deckId: string, status: WebStatus, message?: string): void {
    const s: WebEngineStatus = { deckId, status, ...(message ? { message } : {}) }
    this.statuses.push(s)
    for (const cb of this.statusCbs) cb(s)
  }

  emitCrashed(deckId: string): void {
    for (const cb of this.crashCbs) cb(deckId)
  }

  emitHung(deckId: string): void {
    for (const cb of this.hungCbs) cb(deckId)
  }

  /** The helper process went away: pending calls reject and the supervisor restarts it. */
  emitExit(): void {
    this.alive = false
    for (const cb of this.exitCbs) cb()
  }
}
