import type { Canvas } from '../../shared/canvas'
import type { PrepareInput, WebNavState } from '../../shared/web'
import type { WebEngineStatus, WebOpenOptions, WebPageEngine } from './web-engine'

/** Copy for the operator when the helper has been restarted too many times. */
export const WEB_ENGINE_FALLBACK =
  'The web page helper keeps stopping. Web pages show their last snapshot until the app is restarted.'

export interface WebEngineSupervisorOptions {
  /** Starts a fresh helper (a new WebBridgeEngine, or a FakeWebEngine in tests). */
  create: () => WebPageEngine
  /** HOLD the deck on air (the supervisor only knows deck ids). */
  onHold: (deckId: string) => void
  /** Too many failures: main switches this session to the Electron backend. */
  onFallback: (message: string) => void
  /** Milliseconds between pings. */
  pingMs?: number
  /** Give up after this many helper restarts. */
  maxFailures?: number
}

interface OpenPage {
  options: WebOpenOptions
  /** Last address we asked for (a navigate updates it, so a restart reopens there). */
  url: string
}

/**
 * Keeps the web-bridge helper alive: pings it, and when it hangs or dies it holds the
 * pages on air, starts a new helper in the background and reopens every page. After
 * `maxFailures` restarts it gives up and main falls back to the Electron backend.
 *
 * It is itself the `WebPageEngine` the backend uses, so the backend keeps one stable
 * reference while the helper process behind it is replaced.
 */
export class WebEngineSupervisor implements WebPageEngine {
  private live: WebPageEngine | null = null
  private pages = new Map<string, OpenPage>()
  private failures = 0
  private stopped = false
  private restarting = false
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private navCbs: ((s: WebNavState) => void)[] = []
  private statusCbs: ((s: WebEngineStatus) => void)[] = []
  private crashCbs: ((deckId: string) => void)[] = []
  private hungCbs: ((deckId: string) => void)[] = []
  private exitCbs: (() => void)[] = []
  /** Main's backend uses this to replace its cached window ids and audio pipes. */
  onPagesReopened: (
    pages: Map<string, { windowId: string; audioPipe: string | null }>
  ) => void = () => {}

  constructor(private opts: WebEngineSupervisorOptions) {}

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

  /** True when a helper is running and has not given up. */
  get running(): boolean {
    return !this.stopped && !!this.live?.running
  }

  /** Same as `running`, for the operator-facing "ready" question. */
  ready(): boolean {
    return this.running
  }

  private engine(): WebPageEngine {
    if (this.stopped) throw new Error(WEB_ENGINE_FALLBACK)
    if (!this.live) this.start()
    return this.live!
  }

  private start(): void {
    const engine = this.opts.create()
    this.live = engine
    engine.on('nav', (s) => {
      for (const cb of this.navCbs) cb(s)
    })
    engine.on('status', (s) => {
      for (const cb of this.statusCbs) cb(s)
    })
    engine.on('crashed', (deckId) => {
      for (const cb of this.crashCbs) cb(deckId)
    })
    engine.on('hung', (deckId) => {
      for (const cb of this.hungCbs) cb(deckId)
    })
    engine.on('exited', () => {
      for (const cb of this.exitCbs) cb()
      void this.restart('exited')
    })
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => void this.beat(), this.opts.pingMs ?? 1000)
      this.heartbeat.unref?.()
    }
  }

  /** One heartbeat: an unanswered ping means the helper hangs. */
  private async beat(): Promise<void> {
    if (this.stopped || this.restarting || !this.live) return
    try {
      await this.live.ping()
    } catch {
      await this.restart('hung')
    }
  }

  /** The helper hung or died: hold what is on air, replace it, reopen the pages. */
  private async restart(reason: 'hung' | 'exited'): Promise<void> {
    if (this.stopped || this.restarting) return
    this.restarting = true
    if (reason === 'hung') this.holdEverything()
    const old = this.live
    this.live = null
    if (old) {
      try {
        await old.shutdown()
      } catch {
        // Already gone.
      }
    }
    this.failures++
    if (this.failures > (this.opts.maxFailures ?? 3)) {
      this.stopped = true
      this.stopHeartbeat()
      this.restarting = false
      this.opts.onFallback(WEB_ENGINE_FALLBACK)
      return
    }
    try {
      this.start()
      const engine = this.live!
      const reopened = new Map<string, { windowId: string; audioPipe: string | null }>()
      for (const [deckId, page] of this.pages) {
        const r = await engine.open(deckId, { ...page.options, url: page.url })
        reopened.set(deckId, r)
      }
      this.onPagesReopened(reopened)
    } catch {
      // The new helper did not come up: the next heartbeat tries nothing (stopped);
      // the failure counter above already limits the retries.
      this.stopped = true
      this.stopHeartbeat()
      this.opts.onFallback(WEB_ENGINE_FALLBACK)
    } finally {
      this.restarting = false
    }
  }

  /** A hung helper may not answer anything: HOLD the deck on air (main owns the state). */
  private holdEverything(): void {
    for (const deckId of this.pages.keys()) this.opts.onHold(deckId)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  /** Test hook (FakeWebEngine): make the current helper "die" so recovery can be observed. */
  kill(): void {
    const e = this.live as unknown as { emitExit?: () => void }
    e?.emitExit?.()
  }

  // ---- WebPageEngine ----

  async open(
    deckId: string,
    o: WebOpenOptions
  ): Promise<{ windowId: string; audioPipe: string | null }> {
    this.pages.set(deckId, { options: o, url: o.url })
    try
    {
      return await this.engine().open(deckId, o)
    }
    catch (e)
    {
      // A helper that cannot start at all (missing exe, blocked, no DLL) must degrade the
      // session to the Electron backend, the same way three crashes do.
      if ((e as { code?: string }).code === 'start') this.giveUp()
      throw e
    }
  }

  /** Stop trying and tell main to switch this session to the Electron backend. */
  private giveUp(): void {
    if (this.stopped && !this.live) return
    this.stopped = true
    this.stopHeartbeat()
    this.opts.onFallback(WEB_ENGINE_FALLBACK)
  }

  async navigate(deckId: string, url: string): Promise<void> {
    const page = this.pages.get(deckId)
    if (page) page.url = url
    await this.engine().navigate(deckId, url)
  }

  async reload(deckId: string): Promise<void> {
    await this.engine().reload(deckId)
  }

  stop(deckId: string): void {
    this.live?.stop(deckId)
  }

  setLive(deckId: string, live: boolean): void {
    this.live?.setLive(deckId, live)
  }

  async back(deckId: string): Promise<void> {
    await this.engine().back(deckId)
  }

  async forward(deckId: string): Promise<void> {
    await this.engine().forward(deckId)
  }

  async setZoom(deckId: string, zoom: number): Promise<void> {
    const page = this.pages.get(deckId)
    if (page) page.options = { ...page.options, zoom }
    await this.engine().setZoom(deckId, zoom)
  }

  async resize(deckId: string, canvas: Canvas): Promise<void> {
    const page = this.pages.get(deckId)
    if (page) page.options = { ...page.options, canvas }
    await this.engine().resize(deckId, canvas)
  }

  input(deckId: string, ev: PrepareInput): void {
    this.live?.input(deckId, ev)
  }

  async setMuted(deckId: string, muted: boolean): Promise<void> {
    await this.live?.setMuted(deckId, muted)
  }

  async signOut(profile: string): Promise<void> {
    await this.live?.signOut(profile)
  }

  async close(deckId: string): Promise<void> {
    this.pages.delete(deckId)
    await this.live?.close(deckId)
  }

  async ping(): Promise<void> {
    if (!this.live) return
    await this.live.ping()
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    this.stopHeartbeat()
    this.pages.clear()
    const old = this.live
    this.live = null
    if (old) await old.shutdown()
  }
}
