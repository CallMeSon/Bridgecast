import type { Canvas } from '../../shared/canvas'
import type { DeckMeta } from '../../shared/types'
import type { EngineError, EnginePosition, EngineSession, SlideShowEngine } from './engine'

const never = (): Promise<never> => new Promise(() => {})

/** In-memory engine for tests: steps follow SlideMeta.clicks, hidden slides are skipped by next/prev. */
export class FakeEngine implements SlideShowEngine {
  private posCbs: ((p: EnginePosition) => void)[] = []
  private errCbs: ((e: EngineError) => void)[] = []
  private exitCbs: (() => void)[] = []
  private hung = false
  private crashed = false
  private readyDelay = 0
  private shutdownHangs = false
  private clicksOverride = new Map<string, number[]>()
  private live = new Set<string>()
  /** Highest number of sessions open at the same time. */
  maxOpen = 0
  opens: { deckId: string; file: string; canvas: Canvas }[] = []
  calls: string[] = []
  shutdowns = 0

  constructor(private decks: () => DeckMeta[]) {}

  get openCount(): number {
    return this.live.size
  }

  /** Every call from now on never replies (until shutdown). */
  hang(): void {
    this.hung = true
  }
  /** The engine dies: `exited` is emitted and opens fail until shutdown. */
  crash(): void {
    this.crashed = true
    this.live.clear()
    for (const cb of this.exitCbs) cb()
  }
  /** The next shutdown never replies. */
  hangShutdown(): void {
    this.shutdownHangs = true
  }
  /** The engine counts other clicks for a deck than SlideMeta.clicks (trigger / After Previous). */
  setEngineClicks(deckId: string, clicks: number[]): void {
    this.clicksOverride.set(deckId, clicks)
  }
  /** The engine reports an error. */
  emitError(deckId: string | undefined, message: string): void {
    for (const cb of this.errCbs) cb({ deckId, message })
  }
  /** Opens resolve only after this many ms. */
  delayReady(ms: number): void {
    this.readyDelay = ms
  }

  on(ev: 'position', cb: (p: EnginePosition) => void): void
  on(ev: 'error', cb: (e: EngineError) => void): void
  on(ev: 'exited', cb: () => void): void
  on(ev: 'position' | 'error' | 'exited', cb: never): void {
    if (ev === 'position') this.posCbs.push(cb)
    else if (ev === 'error') this.errCbs.push(cb)
    else this.exitCbs.push(cb)
  }

  async ping(): Promise<void> {
    if (this.hung) return never()
  }

  async shutdown(): Promise<void> {
    this.shutdowns++
    this.hung = false
    this.crashed = false
    this.live.clear()
    if (this.shutdownHangs) {
      this.shutdownHangs = false
      return never()
    }
  }

  async open(deckId: string, file: string, canvas: Canvas): Promise<EngineSession> {
    this.calls.push(`open:${deckId}`)
    this.opens.push({ deckId, file, canvas })
    if (this.hung) return never()
    if (this.crashed) throw new Error('engine crashed')
    this.live.add(deckId)
    this.maxOpen = Math.max(this.maxOpen, this.live.size)
    if (this.readyDelay > 0) await new Promise((r) => setTimeout(r, this.readyDelay))
    const slides = (): DeckMeta['slides'] => this.decks().find((d) => d.id === deckId)?.slides ?? []
    const clicks = (i: number): number =>
      this.clicksOverride.get(deckId)?.[i] ?? slides()[i]?.clicks ?? 0
    const shown = (i: number): boolean => !slides()[i]?.hidden
    let index = 0
    let step = 0
    const emit = (): void => {
      const p = { deckId, index, step, clicks: clicks(index) }
      for (const cb of this.posCbs) cb(p)
    }
    const guard = async (label: string): Promise<void> => {
      this.calls.push(label)
      if (this.hung) return never()
      if (this.crashed || !this.live.has(deckId)) throw new Error('session closed')
    }
    return {
      deckId,
      windowId: fakeWindowId(deckId),
      next: async () => {
        await guard(`next:${deckId}`)
        if (step < clicks(index)) step++
        else {
          let i = index + 1
          while (i < slides().length && !shown(i)) i++
          if (i < slides().length) {
            index = i
            step = 0
          }
        }
        emit()
      },
      prev: async () => {
        await guard(`prev:${deckId}`)
        if (step > 0) step--
        else {
          let i = index - 1
          while (i >= 0 && !shown(i)) i--
          if (i >= 0) {
            index = i
            step = clicks(i)
          }
        }
        emit()
      },
      goto: async (i: number) => {
        await guard(`goto:${deckId}:${i}`)
        index = i
        step = 0
        emit()
      },
      close: async () => {
        this.calls.push(`close:${deckId}`)
        if (this.hung) return never()
        this.live.delete(deckId)
      }
    }
  }
}

/** Window ids are decimal handles like the bridge's HWNDs (`slideshow:sourceId` rejects anything else); stable per deck. */
const windowIds = new Map<string, string>()
function fakeWindowId(deckId: string): string {
  let id = windowIds.get(deckId)
  if (!id) {
    id = String(1000 + windowIds.size)
    windowIds.set(deckId, id)
  }
  return id
}
