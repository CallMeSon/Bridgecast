import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Canvas } from '../../shared/canvas'
import type { PrepareInput, WebNavState, WebStatus } from '../../shared/web'
import { BridgeClient, BridgeError, type BridgeEvent } from '../slideshow/bridge-protocol'
import type { BridgeChild } from '../slideshow/powerpoint-engine'

export const WEB_HELPER_START_FAILED =
  'The web page helper could not start. Reinstall Bridgecast. Showing the last snapshot.'

/** The part of a child process the engine uses (a fake in tests). */
export type WebBridgeChild = BridgeChild

type SpawnFn = (exe: string, args: string[]) => BridgeChild

const defaultSpawn: SpawnFn = (exe, args) =>
  nodeSpawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) as BridgeChild

/** Where web-bridge.exe is: `resources/web-bridge/` packaged, the build output in dev. */
export function webBridgeExePath(opts: {
  packaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return opts.packaged
    ? path.join(opts.resourcesPath, 'web-bridge', 'web-bridge.exe')
    : path.join(opts.appPath, 'native', 'web-bridge', 'bin', 'Release', 'net48', 'web-bridge.exe')
}

/** A page's load state changed (`status`). */
export interface WebEngineStatus {
  deckId: string
  status: WebStatus
  message?: string
}

export interface WebOpenOptions {
  url: string
  canvas: Canvas
  /** Page zoom (the helper applies it to the page, not to the window). */
  zoom: number
  /** WebView2 profile name: `default` or a deck id (its own sign-in profile). */
  profile: string
  /** The deck is on the output (the helper refuses new windows while it is). */
  live?: boolean
  /** Where the helper puts the window (main parks it off the desktop). */
  x?: number
  y?: number
}

/**
 * The web page engine: one helper process hosting one WebView2 window per deck, driven
 * over JSON lines (see `native/web-bridge/README.md`). The app captures the window with
 * `desktopCapturer` and reads the deck's sound from `audioPipe`.
 */
export interface WebPageEngine {
  /** The helper is running (started and not exited). */
  readonly running: boolean
  open(deckId: string, o: WebOpenOptions): Promise<{ windowId: string; audioPipe: string | null }>
  navigate(deckId: string, url: string): Promise<void>
  reload(deckId: string): Promise<void>
  /** Ends a load in progress (the Prepare toolbar's Stop). */
  stop(deckId: string): void
  back(deckId: string): Promise<void>
  forward(deckId: string): Promise<void>
  setZoom(deckId: string, zoom: number): Promise<void>
  resize(deckId: string, canvas: Canvas): Promise<void>
  /** Fire and forget: input never delays the operator. */
  input(deckId: string, ev: PrepareInput): void
  /** A PNG of the page itself (base64), from WebView2's own capture (no cursor, no frame). */
  snapshot(deckId: string): Promise<string | null>
  setMuted(deckId: string, muted: boolean): Promise<void>
  /** The deck went on or off the output (a page on air may not open a window). */
  setLive(deckId: string, live: boolean): void
  signOut(profile: string): Promise<void>
  close(deckId: string): Promise<void>
  /** Never replies when the helper hangs (the supervisor's heartbeat). */
  ping(): Promise<void>
  on(ev: 'nav', cb: (s: WebNavState) => void): void
  on(ev: 'status', cb: (s: WebEngineStatus) => void): void
  on(ev: 'crashed', cb: (deckId: string) => void): void
  /** The page did not answer for 5 s (a hung renderer keeps the helper itself alive). */
  on(ev: 'hung', cb: (deckId: string) => void): void
  on(ev: 'exited', cb: () => void): void
  shutdown(): Promise<void>
}

interface WebBridgeEngineOptions {
  exe: string
  /** WebView2 user data root (the app's `userData`/web-profile). */
  userData: string
  spawn?: SpawnFn
  /** Extra helper arguments after `--user-data` (the Linux helper takes `--browser`). */
  args?: string[]
  exists?: (file: string) => boolean
  /** Called when the helper cannot start. */
  onStartFailure?: (message: string) => void
  /** How long shutdown waits for the helper to exit before killing it. */
  shutdownMs?: number
}

const OPEN_MS = 60_000
const MOVE_MS = 5_000
const PING_MS = 3_000
/** A page snapshot is a PNG of the whole canvas; it can take a moment. */
const SNAPSHOT_MS = 15_000

interface Live {
  child: BridgeChild
  client: BridgeClient
  stopping: boolean
  exited: boolean
  /** The helper has written something: a later `error` is a broken pipe, not a failed start. */
  heard: boolean
}

const STATUSES = new Set<WebStatus>(['loading', 'ready', 'error'])

export class WebBridgeEngine implements WebPageEngine {
  private navCbs: ((s: WebNavState) => void)[] = []
  private statusCbs: ((s: WebEngineStatus) => void)[] = []
  private crashCbs: ((deckId: string) => void)[] = []
  private hungCbs: ((deckId: string) => void)[] = []
  private exitCbs: (() => void)[] = []
  private live: Live | null = null
  private startError: string | null = null
  /** Zoom per open deck, so a `nav` event carries the zoom the page is drawn at. */
  private zooms = new Map<string, number>()

  constructor(private opts: WebBridgeEngineOptions) {}

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

  /** The helper is running (started and not exited). */
  get running(): boolean {
    return !!this.live && !this.live.exited
  }

  get helperError(): string | null {
    return this.startError
  }

  private start(): Live {
    if (this.live && !this.live.exited) return this.live
    const exists = this.opts.exists ?? fs.existsSync
    if (!exists(this.opts.exe)) this.failStart(`web helper not found at ${this.opts.exe}`)
    let child: BridgeChild
    try {
      child = (this.opts.spawn ?? defaultSpawn)(this.opts.exe, [
        '--user-data',
        this.opts.userData,
        ...(this.opts.args ?? [])
      ])
    } catch (e) {
      return this.failStart(e instanceof Error ? e.message : String(e))
    }
    const client = new BridgeClient((line) => {
      child.stdin.write(line)
    })
    const live: Live = { child, client, stopping: false, exited: false, heard: false }
    const out = new StringDecoder('utf8')
    child.stdout.on('data', (c) => {
      live.heard = true
      client.feed(typeof c === 'string' ? c : out.write(c))
    })
    const err = new StringDecoder('utf8')
    child.stderr?.on('data', (c) => {
      live.heard = true
      const text = (typeof c === 'string' ? c : err.write(c)).trim()
      if (text) console.warn('[web-bridge]', text)
    })
    client.onEvent((e) => this.onBridgeEvent(live, e))
    child.on('error', (e) => {
      if (live.exited) return
      console.error('[web-bridge] helper error:', e.message)
      this.gone(live, !live.heard, e.message)
    })
    child.on('exit', (code) => {
      if (live.exited) return
      if (!live.stopping) console.error('[web-bridge] helper exited, code', code)
      this.gone(live, !live.heard && !live.stopping, `exit code ${code}`)
    })
    this.live = live
    return live
  }

  private failStart(reason: string): never {
    console.error('[web-bridge] start failed:', reason)
    this.startError = WEB_HELPER_START_FAILED
    this.opts.onStartFailure?.(WEB_HELPER_START_FAILED)
    throw new BridgeError('start', WEB_HELPER_START_FAILED)
  }

  private gone(live: Live, startFailure: boolean, reason?: string): void {
    if (live.exited) return
    live.exited = true
    live.client.failAll(
      startFailure ? 'start' : 'exited',
      startFailure
        ? WEB_HELPER_START_FAILED
        : 'The web page helper stopped. Showing the last snapshot.'
    )
    if (this.live === live) this.live = null
    this.zooms.clear()
    if (startFailure) {
      console.error('[web-bridge] start failed:', reason)
      this.startError = WEB_HELPER_START_FAILED
      this.opts.onStartFailure?.(WEB_HELPER_START_FAILED)
      return
    }
    if (!live.stopping) for (const cb of this.exitCbs) cb()
  }

  private onBridgeEvent(live: Live, e: BridgeEvent): void {
    if (e.event === 'exited') {
      this.gone(live, false)
      return
    }
    if (e.event === 'nav') {
      const s = this.navState(e)
      if (s) for (const cb of this.navCbs) cb(s)
      return
    }
    if (e.event === 'status') {
      const deckId = e.deckId
      const status = e.status
      if (typeof deckId !== 'string' || typeof status !== 'string') return
      if (!STATUSES.has(status as WebStatus)) return
      const s: WebEngineStatus = { deckId, status: status as WebStatus }
      if (typeof e.message === 'string') s.message = e.message
      for (const cb of this.statusCbs) cb(s)
      return
    }
    if (e.event === 'crashed') {
      if (typeof e.deckId !== 'string') return
      for (const cb of this.crashCbs) cb(e.deckId)
    }
    if (e.event === 'hung') {
      if (typeof e.deckId !== 'string') return
      for (const cb of this.hungCbs) cb(e.deckId)
    }
  }

  private navState(e: BridgeEvent): WebNavState | null {
    const { deckId, url, title, canGoBack, canGoForward, loading, cursor } = e
    if (
      typeof deckId !== 'string' ||
      typeof url !== 'string' ||
      typeof title !== 'string' ||
      typeof canGoBack !== 'boolean' ||
      typeof canGoForward !== 'boolean' ||
      typeof loading !== 'boolean' ||
      typeof cursor !== 'string'
    )
      return null
    return {
      deckId,
      url,
      title,
      canGoBack,
      canGoForward,
      loading,
      zoom: this.zooms.get(deckId) ?? 1,
      cursor
    }
  }

  async open(
    deckId: string,
    o: WebOpenOptions
  ): Promise<{ windowId: string; audioPipe: string | null }> {
    const live = this.start()
    const res = await live.client.request(
      'open',
      {
        deckId,
        url: o.url,
        width: o.canvas.width,
        height: o.canvas.height,
        x: o.x ?? 0,
        y: o.y ?? 0,
        profile: o.profile,
        zoom: o.zoom,
        live: o.live ?? false
      },
      OPEN_MS
    )
    const windowId = res.windowId
    if (typeof windowId !== 'string' || !windowId) {
      throw new BridgeError('protocol', 'The web page helper did not return a window.')
    }
    this.startError = null
    this.zooms.set(deckId, o.zoom)
    return {
      windowId,
      audioPipe: typeof res.audioPipe === 'string' ? res.audioPipe : null
    }
  }

  private async call(
    cmd: 'navigate' | 'reload' | 'back' | 'forward' | 'close',
    deckId: string,
    args: object = {}
  ): Promise<void> {
    const live = this.live
    if (!live || live.exited) throw new BridgeError('exited', 'The web page helper stopped.')
    await live.client.request(cmd, { deckId, ...args }, MOVE_MS)
  }

  navigate(deckId: string, url: string): Promise<void> {
    return this.call('navigate', deckId, { url })
  }

  reload(deckId: string): Promise<void> {
    return this.call('reload', deckId)
  }

  stop(deckId: string): void {
    const live = this.live
    if (!live || live.exited) return
    live.client.request('stop', { deckId }, MOVE_MS).catch(() => undefined)
  }

  /** Fire and forget: the helper keeps this for its popup rule. */
  setLive(deckId: string, live: boolean): void {
    const l = this.live
    if (!l || l.exited) return
    l.client.request('setLive', { deckId, live }, MOVE_MS).catch(() => undefined)
  }

  back(deckId: string): Promise<void> {
    return this.call('back', deckId)
  }

  forward(deckId: string): Promise<void> {
    return this.call('forward', deckId)
  }

  close(deckId: string): Promise<void> {
    this.zooms.delete(deckId)
    return this.call('close', deckId)
  }

  async setZoom(deckId: string, zoom: number): Promise<void> {
    const live = this.live
    if (!live || live.exited) throw new BridgeError('exited', 'The web page helper stopped.')
    await live.client.request('setZoom', { deckId, zoom }, MOVE_MS)
    this.zooms.set(deckId, zoom)
  }

  async resize(deckId: string, canvas: Canvas): Promise<void> {
    const live = this.live
    if (!live || live.exited) throw new BridgeError('exited', 'The web page helper stopped.')
    await live.client.request(
      'resize',
      { deckId, width: canvas.width, height: canvas.height },
      MOVE_MS
    )
  }

  input(deckId: string, ev: PrepareInput): void {
    const live = this.live
    if (!live || live.exited) return
    // No reply is needed (and a stuck page must not block the operator's click).
    live.client.request('input', { deckId, ev }, MOVE_MS).catch(() => undefined)
  }

  async setMuted(deckId: string, muted: boolean): Promise<void> {
    const live = this.live
    if (!live || live.exited) return
    await live.client.request('setMuted', { deckId, muted }, MOVE_MS)
  }

  async snapshot(deckId: string): Promise<string | null> {
    const live = this.live
    if (!live || live.exited) return null
    const res = await live.client.request('snapshot', { deckId }, SNAPSHOT_MS)
    return typeof res.png === 'string' && res.png.length > 0 ? res.png : null
  }

  async signOut(profile: string): Promise<void> {
    const live = this.live
    if (!live || live.exited) return
    await live.client.request('signOut', { profile }, OPEN_MS)
  }

  /** Resolves at once when nothing runs: nothing can hang. */
  async ping(): Promise<void> {
    const live = this.live
    if (!live || live.exited) return
    await live.client.request('ping', {}, PING_MS)
  }

  /**
   * Ends the helper: closing stdin makes it close its WebView2 windows and browser
   * processes. After the wait only the helper process is killed; no browser process is
   * killed by the app itself (the helper owns its environment).
   */
  async shutdown(): Promise<void> {
    const live = this.live
    this.live = null
    this.zooms.clear()
    if (!live || live.exited) return
    live.stopping = true
    live.client.failAll('exited', 'The web page helper is shutting down.')
    await new Promise<void>((resolve) => {
      let done = false
      const timer = setTimeout(() => {
        try {
          live.child.kill()
        } catch {
          /* already gone */
        }
        finish()
      }, this.opts.shutdownMs ?? 5000)
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        live.exited = true
        resolve()
      }
      live.child.on('exit', finish)
      try {
        live.child.stdin.end()
      } catch {
        try {
          live.child.kill()
        } catch {
          /* already gone */
        }
        finish()
      }
    })
  }
}
