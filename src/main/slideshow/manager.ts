import type { Canvas } from '../../shared/canvas'
import { playbackOf } from '../../shared/playback'
import type { ProgramState } from '../../shared/program'
import type { DeckMeta } from '../../shared/types'
import type { AppState } from '../state'
import type { EngineSession, SlideShowEngine } from './engine'

export const HEARTBEAT_MS = 1000
export const HANG_MS = 3000
const RETRY_MS = 3000
/** Live deck + the next native deck. */
const MAX_SESSIONS = 2

export interface ManagerTimers {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (h: unknown) => void
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
  now: () => number
}

const realTimers: ManagerTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now()
}

interface Entry {
  deckId: string
  canvas: Canvas
  session: EngineSession | null
  closing: boolean
  /** Where the engine is in this deck (after open: the first slide). */
  pos: { index: number; step: number } | null
}

const sameCanvas = (a: Canvas, b: Canvas): boolean => a.width === b.width && a.height === b.height

/**
 * Keeps the native slideshow sessions (live deck + next native deck, at most 2),
 * drives the engine from state changes and reports the engine position back.
 * The engine position wins over reducer state.
 */
export class SlideShowManager {
  private entries = new Map<string, Entry>()
  /** nativeFallback was dispatched for these decks and not yet resumed. */
  private fallen = new Set<string>()
  private down = false
  private lastOk: number
  private pingInFlight = false
  private heartbeat: unknown
  private retry: unknown = null
  private chain: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private engine: SlideShowEngine,
    private state: AppState,
    private decks: () => DeckMeta[],
    private canvas: () => Canvas,
    private timers: ManagerTimers = realTimers,
    /** Path of the deck's PowerPoint file. */
    private fileOf: (deckId: string) => string = (id) => id
  ) {
    this.lastOk = timers.now()
    engine.on('position', (p) => this.onPosition(p.deckId, p.index, p.step))
    engine.on('error', (e) => {
      if (e.deckId) this.failDeck(e.deckId)
    })
    engine.on('exited', () => this.engineDown())
    state.onChange(() => this.sync())
    this.heartbeat = timers.setInterval(() => this.tick(), HEARTBEAT_MS)
  }

  /** The deck's slideshow is open, the engine is up and no fallback is pending. */
  ready(deckId: string): boolean {
    const e = this.entries.get(deckId)
    return !!e?.session && !e.closing && !this.down && !this.fallen.has(deckId)
  }

  windowId(deckId: string): string | null {
    const e = this.entries.get(deckId)
    return e?.session && !e.closing ? e.session.windowId : null
  }

  dispose(): void {
    this.disposed = true
    this.timers.clearInterval(this.heartbeat)
    if (this.retry !== null) this.timers.clearTimeout(this.retry)
  }

  /** Bring sessions and the engine position in line with the state. */
  sync(): void {
    if (this.disposed) return
    const s = this.state.state
    const decks = this.decks()
    const wanted = this.wantedDecks(s, decks)
    const live = this.liveNative(s, decks)
    const canvas = this.canvas()

    // A fallback only lasts while its deck is on air.
    for (const id of [...this.fallen]) if (id !== live) this.fallen.delete(id)

    for (const e of this.entries.values()) {
      const keep = wanted.includes(e.deckId)
      const stale = e.deckId !== live && !sameCanvas(e.canvas, canvas)
      if (!e.closing && (!keep || stale)) this.closeEntry(e)
    }
    if (!this.down) {
      for (const id of wanted) {
        if (this.entries.has(id)) continue
        if (this.entries.size >= MAX_SESSIONS) break // wait for a close to finish
        this.openEntry(id, canvas)
      }
    }
    if (live) this.drive(live)
  }

  private liveNative(s: ProgramState, decks: DeckMeta[]): string | null {
    const id = s.shown?.deckId
    const d = id ? decks.find((x) => x.id === id) : undefined
    return d && playbackOf(d) === 'native' ? d.id : null
  }

  private wantedDecks(s: ProgramState, decks: DeckMeta[]): string[] {
    const isNative = (d: DeckMeta): boolean => playbackOf(d) === 'native'
    const anchor = this.liveNative(s, decks) ?? s.deckId ?? null
    const out: string[] = []
    const at = decks.findIndex((d) => d.id === anchor)
    if (at < 0) return out
    if (isNative(decks[at])) out.push(decks[at].id)
    const next = decks.slice(at + 1).find(isNative)
    if (next) out.push(next.id)
    return out.slice(0, MAX_SESSIONS)
  }

  private openEntry(deckId: string, canvas: Canvas): void {
    const e: Entry = { deckId, canvas: { ...canvas }, session: null, closing: false, pos: null }
    this.entries.set(deckId, e)
    this.engine.open(deckId, this.fileOf(deckId), canvas).then(
      (session) => {
        if (this.entries.get(deckId) !== e) {
          void session.close().catch(() => {}) // engine restarted meanwhile
          return
        }
        e.session = session
        e.pos = { index: 0, step: 0 }
        if (e.closing) return this.finishClose(e)
        this.afterOpen(deckId)
      },
      () => {
        if (this.entries.get(deckId) !== e) return
        this.entries.delete(deckId)
        if (this.liveNative(this.state.state, this.decks()) === deckId) this.fallBack(deckId)
        this.scheduleRetry()
      }
    )
  }

  private afterOpen(deckId: string): void {
    const live = this.liveNative(this.state.state, this.decks())
    const shown = this.state.state.shown
    if (live === deckId && (this.fallen.has(deckId) || shown?.playback === 'images')) {
      // Taken before the session was ready, or fell back: native again. Clear the
      // fallback first, the reducer asks `ready`.
      this.fallen.delete(deckId)
      this.state.dispatch({ type: 'resumeNative', deckId })
    }
    this.sync()
  }

  private closeEntry(e: Entry): void {
    e.closing = true
    if (e.session) this.finishClose(e)
    // else: the open is still pending; it closes the session when it resolves
  }

  private finishClose(e: Entry): void {
    const done = (): void => {
      if (this.entries.get(e.deckId) === e) this.entries.delete(e.deckId)
      this.sync()
    }
    e.session!.close().then(done, done)
  }

  private scheduleRetry(): void {
    if (this.retry !== null || this.disposed) return
    this.retry = this.timers.setTimeout(() => {
      this.retry = null
      this.sync()
    }, RETRY_MS)
  }

  private fallBack(deckId: string): void {
    this.fallen.add(deckId)
    this.state.dispatch({ type: 'nativeFallback', deckId })
  }

  private failDeck(deckId: string): void {
    const e = this.entries.get(deckId)
    if (e) this.entries.delete(deckId)
    if (this.liveNative(this.state.state, this.decks()) === deckId) this.fallBack(deckId)
    this.scheduleRetry()
  }

  /** Engine hung or died: images take over, restart in the background. */
  private engineDown(): void {
    if (this.down || this.disposed) return
    this.down = true
    const live = this.liveNative(this.state.state, this.decks())
    this.entries.clear()
    if (live) this.fallBack(live)
    this.engine.shutdown().then(
      () => this.restarted(),
      () => this.restarted()
    )
  }

  private restarted(): void {
    this.down = false
    this.lastOk = this.timers.now()
    this.sync()
    if (this.entries.size === 0) this.scheduleRetry()
  }

  private tick(): void {
    const now = this.timers.now()
    if (this.down || this.entries.size === 0) {
      this.lastOk = now
      return
    }
    if (!this.engine.ping) return
    if (!this.pingInFlight) {
      this.pingInFlight = true
      this.engine
        .ping()
        .then(
          () => {
            this.lastOk = this.timers.now()
          },
          () => {}
        )
        .finally(() => {
          this.pingInFlight = false
        })
    }
    if (now - this.lastOk >= HANG_MS) this.engineDown()
  }

  private onPosition(deckId: string, index: number, step: number): void {
    const e = this.entries.get(deckId)
    if (e) e.pos = { index, step }
    const shown = this.state.state.shown
    if (shown?.deckId === deckId && shown.playback === 'native') {
      this.state.dispatch({ type: 'enginePosition', deckId, index, step })
    }
  }

  /** Queue the engine moves so they never overlap. */
  private drive(deckId: string): void {
    this.chain = this.chain.then(() => this.driveNow(deckId)).catch(() => {})
  }

  private async driveNow(deckId: string): Promise<void> {
    const s = this.state.state
    const shown = s.shown
    const e = this.entries.get(deckId)
    if (!shown || shown.deckId !== deckId || shown.playback !== 'native') return
    if (!e?.session || e.closing || !e.pos || !this.ready(deckId)) return
    const slides = this.decks().find((d) => d.id === deckId)?.slides ?? []
    const clicks = (i: number): number => slides[i]?.clicks ?? 0
    const cur = e.pos
    const to = { index: shown.index, step: shown.step ?? 0 }
    if (cur.index === to.index && cur.step === to.step) return
    const session = e.session
    if (cur.index === to.index && to.step === cur.step + 1) return session.next()
    if (cur.index === to.index && to.step === cur.step - 1) return session.prev()
    if (to.index > cur.index && to.step === 0 && cur.step >= clicks(cur.index)) {
      const between = slides.slice(cur.index + 1, to.index)
      if (between.every((x) => x.hidden)) return session.next()
    }
    if (to.index < cur.index && cur.step === 0 && to.step === clicks(to.index)) {
      const between = slides.slice(to.index + 1, cur.index)
      if (between.every((x) => x.hidden)) return session.prev()
    }
    await session.goto(to.index)
    // Build the slide up to the wanted step; the engine position still wins afterwards.
    for (let i = 0; i < to.step && i < clicks(to.index); i++) await session.next()
  }
}
