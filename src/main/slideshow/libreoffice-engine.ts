import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Canvas } from '../../shared/canvas'
import { childEnv } from '../platform'
import { BridgeClient, BridgeError, type BridgeEvent } from './bridge-protocol'
import type { EngineError, EnginePosition, EngineSession, SlideShowEngine } from './engine'
import type { BridgeChild } from './powerpoint-engine'
import { SINK_NAME } from './pulse-sink'

export const LO_START_FAILED =
  'LibreOffice could not start. Close LibreOffice windows that are stuck, then press Resume LibreOffice. Showing still slides.'
/** Shown when LibreOffice's sound cannot be routed by the app (no pactl, sink not created). */
export const LO_DEFAULT_DEVICE_SOUND = "LibreOffice sound plays on this PC's default device only."

type LoSpawnFn = (
  python: string,
  args: string[],
  env: Record<string, string | undefined>
) => BridgeChild

const defaultSpawn: LoSpawnFn = (python, args, env) =>
  nodeSpawn(python, args, { stdio: ['pipe', 'pipe', 'pipe'], env }) as BridgeChild

/** Where `bridge.py` is: `resources/lo-bridge/` packaged, `native/lo-bridge/` in dev. */
export function loBridgePath(opts: {
  packaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return opts.packaged
    ? path.join(opts.resourcesPath, 'lo-bridge', 'bridge.py')
    : path.join(opts.appPath, 'native', 'lo-bridge', 'bridge.py')
}

interface LibreOfficeEngineOptions {
  script: string
  /** The app's own LibreOffice profile (`<userData>/lo-profile`). */
  profile: string
  spawn?: LoSpawnFn
  /** This process's environment (default `process.env`); the bridge gets it through `childEnv`. */
  env?: Record<string, string | undefined>
  exists?: (file: string) => boolean
  /** Creates the private sound sink; true when LibreOffice's sound can be captured. */
  ensureSink?: () => Promise<boolean>
  onStartFailure?: (message: string) => void
  /** The sound route changed (a session opened, the bridge stopped). */
  onAudio?: (a: { mode: 'monitor' | 'device' | 'none'; note: string | null }) => void
  shutdownMs?: number
}

const OPEN_MS = 90_000
const MOVE_MS = 5_000
const PING_MS = 3_000
const EDIT_MS = 30_000
const IMPORT_MS = 5 * 60_000

interface Live {
  child: BridgeChild
  client: BridgeClient
  stopping: boolean
  exited: boolean
  heard: boolean
  sink: boolean
}

/**
 * Slide shows in LibreOffice Impress, driven by `native/lo-bridge/bridge.py` over the same JSON
 * lines as ppt-bridge. The bridge starts with the first call and again after a `shutdown`; it owns
 * a `soffice` with the app's own profile and kills only that one (never the user's LibreOffice).
 */
export class LibreOfficeEngine implements SlideShowEngine {
  private posCbs: ((p: EnginePosition) => void)[] = []
  private errCbs: ((e: EngineError) => void)[] = []
  private exitCbs: (() => void)[] = []
  private live: Live | null = null
  private startError: string | null = null

  constructor(private opts: LibreOfficeEngineOptions) {}

  on(ev: 'position', cb: (p: EnginePosition) => void): void
  on(ev: 'error', cb: (e: EngineError) => void): void
  on(ev: 'exited', cb: () => void): void
  on(ev: 'position' | 'error' | 'exited', cb: never): void {
    if (ev === 'position') this.posCbs.push(cb)
    else if (ev === 'error') this.errCbs.push(cb)
    else this.exitCbs.push(cb)
  }

  get running(): boolean {
    return !!this.live && !this.live.exited
  }

  /** Last start failure for the operator UI; null when the bridge started. */
  get helperError(): string | null {
    return this.startError
  }

  private async start(): Promise<Live> {
    if (this.live && !this.live.exited) return this.live
    const exists = this.opts.exists ?? fs.existsSync
    if (!exists(this.opts.script)) this.failStart(`bridge.py not found at ${this.opts.script}`)
    let sink = false
    try {
      sink = (await this.opts.ensureSink?.()) ?? false
    } catch {
      sink = false
    }
    // Another call may have started the bridge while the sink was being made.
    if (this.live && !this.live.exited) return this.live
    const args = [this.opts.script, '--profile', this.opts.profile]
    if (sink) args.push('--pulse-sink', SINK_NAME)
    let child: BridgeChild
    try {
      // The session's own XDG_SESSION_TYPE (the app may say x11 for its capture): the bridge
      // sets the X11 VCL plugin for its soffice itself, and Edit opens the user's LibreOffice.
      const env = childEnv(this.opts.env ?? process.env)
      child = (this.opts.spawn ?? defaultSpawn)('python3', args, env)
    } catch (e) {
      return this.failStart(e instanceof Error ? e.message : String(e))
    }
    const client = new BridgeClient((line) => {
      child.stdin.write(line)
    })
    const live: Live = { child, client, stopping: false, exited: false, heard: false, sink }
    const out = new StringDecoder('utf8')
    child.stdout.on('data', (c) => {
      live.heard = true
      client.feed(typeof c === 'string' ? c : out.write(c))
    })
    const err = new StringDecoder('utf8')
    child.stderr?.on('data', (c) => {
      live.heard = true
      const text = (typeof c === 'string' ? c : err.write(c)).trim()
      if (text) console.warn('[lo-bridge]', text)
    })
    client.onEvent((e) => this.onBridgeEvent(live, e))
    child.on('error', (e) => {
      if (live.exited) return
      console.error('[lo-bridge] error:', e.message)
      this.gone(live, !live.heard, e.message)
    })
    child.on('exit', (code) => {
      if (live.exited) return
      if (!live.stopping) console.error('[lo-bridge] exited, code', code)
      this.gone(live, !live.heard && !live.stopping, `exit code ${code}`)
    })
    this.live = live
    return live
  }

  private failStart(reason: string): never {
    console.error('[lo-bridge] start failed:', reason)
    this.startError = LO_START_FAILED
    this.opts.onStartFailure?.(LO_START_FAILED)
    throw new BridgeError('start', LO_START_FAILED)
  }

  private gone(live: Live, startFailure: boolean, reason?: string): void {
    if (live.exited) return
    live.exited = true
    live.client.failAll(
      startFailure ? 'start' : 'exited',
      startFailure ? LO_START_FAILED : 'LibreOffice stopped. Showing still slides.'
    )
    if (this.live === live) this.live = null
    this.opts.onAudio?.({ mode: 'none', note: null })
    if (startFailure) {
      console.error('[lo-bridge] start failed:', reason)
      this.startError = LO_START_FAILED
      this.opts.onStartFailure?.(LO_START_FAILED)
      return
    }
    if (!live.stopping) for (const cb of this.exitCbs) cb()
  }

  private onBridgeEvent(live: Live, e: BridgeEvent): void {
    if (e.event === 'exited') {
      this.gone(live, false)
      return
    }
    if (e.event === 'position') {
      const { deckId, index, step, clicks } = e as Record<string, unknown>
      if (
        typeof deckId === 'string' &&
        Number.isInteger(index) &&
        Number.isInteger(step) &&
        Number.isInteger(clicks)
      ) {
        const p: EnginePosition = {
          deckId,
          index: index as number,
          step: step as number,
          clicks: clicks as number
        }
        for (const cb of this.posCbs) cb(p)
      }
      return
    }
    if (e.event === 'error') {
      const err: EngineError = {
        message: typeof e.message === 'string' ? e.message : 'The slide show reported an error.',
        ...(typeof e.deckId === 'string' ? { deckId: e.deckId } : {})
      }
      for (const cb of this.errCbs) cb(err)
    }
  }

  /** A request that turns a bridge `start` failure into the operator copy and remembers it. */
  private async request(
    live: Live,
    cmd: 'open' | 'edit' | 'import',
    args: Record<string, unknown>,
    ms: number
  ): Promise<Record<string, unknown>> {
    try {
      const r = await live.client.request(cmd, args, ms)
      this.startError = null
      return r
    } catch (e) {
      if (e instanceof BridgeError && e.code === 'start') {
        this.startError = e.message
        this.opts.onStartFailure?.(e.message)
      }
      throw e
    }
  }

  async open(deckId: string, file: string, canvas: Canvas): Promise<EngineSession> {
    const live = await this.start()
    const res = await this.request(
      live,
      'open',
      {
        deckId,
        file,
        width: canvas.width,
        height: canvas.height,
        dpi: 96,
        x: 0,
        y: 0,
        behind: true
      },
      OPEN_MS
    )
    const windowId = res.windowId
    if (typeof windowId !== 'string' || !windowId) {
      throw new BridgeError('protocol', 'LibreOffice did not return a slide show window.')
    }
    this.opts.onAudio?.(
      live.sink
        ? { mode: 'monitor', note: null }
        : { mode: 'device', note: LO_DEFAULT_DEVICE_SOUND }
    )
    const call = async (cmd: 'next' | 'prev' | 'goto' | 'close', args: object): Promise<void> => {
      if (this.live !== live || live.exited) {
        throw new BridgeError('exited', 'LibreOffice stopped.')
      }
      await live.client.request(cmd, { deckId, ...args }, MOVE_MS)
    }
    return {
      deckId,
      windowId,
      next: () => call('next', {}),
      prev: () => call('prev', {}),
      goto: (index) => call('goto', { index }),
      close: () => call('close', {})
    }
  }

  async ping(): Promise<void> {
    const live = this.live
    if (!live || live.exited) return
    await live.client.request('ping', {}, PING_MS)
  }

  /** The PowerPoint import: the bridge opens the file hidden and writes the deck's files to `outDir`. */
  async importDeck(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    const live = await this.start()
    return this.request(live, 'import', req, IMPORT_MS)
  }

  /** Opens the working copy in the user's own LibreOffice (their profile and window). */
  async edit(file: string): Promise<void> {
    const live = await this.start()
    await this.request(live, 'edit', { file }, EDIT_MS)
  }

  /**
   * Ends the bridge: closing its stdin makes it close its shows and stop its soffice. After the
   * wait only the bridge process is killed; a soffice left behind is stopped by the next bridge
   * (same profile). The user's LibreOffice is never touched.
   */
  async shutdown(): Promise<void> {
    const live = this.live
    this.live = null
    this.opts.onAudio?.({ mode: 'none', note: null })
    if (!live || live.exited) return
    live.stopping = true
    live.client.failAll('exited', 'LibreOffice is shutting down.')
    await new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        live.exited = true
        resolve()
      }
      const timer = setTimeout(() => {
        try {
          live.child.kill()
        } catch {
          /* already gone */
        }
        finish()
      }, this.opts.shutdownMs ?? 10_000)
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
