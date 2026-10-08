import type { Library } from './library'
import type { DeckMeta, EventMeta } from '../shared/types'
import { kvImageUrl } from '../shared/ipc'
import {
  followSlideOrder,
  initialState,
  kvOnAir,
  locateShown,
  reconcile,
  reduce,
  type Action,
  type ProgramState
} from '../shared/program'

type Position = { deckId: string | null; index: number }

function same(a: ProgramState, b: ProgramState): boolean {
  return (
    a.deckId === b.deckId &&
    a.index === b.index &&
    a.frozen === b.frozen &&
    a.black === b.black &&
    a.kv === b.kv &&
    a.kvUrl === b.kvUrl &&
    a.transition === b.transition &&
    a.autoAdvance === b.autoAdvance &&
    a.shown?.deckId === b.shown?.deckId &&
    a.shown?.index === b.shown?.index &&
    a.shown?.file === b.shown?.file
  )
}

/**
 * Holds the active event and the Program state. The operator position always
 * belongs to the active event; `shown` (what is on the output) may still point
 * at a deck of another event and is only cleared when that slide disappears.
 */
export class AppState {
  private current: ProgramState
  private activeEvent: string | null
  private listeners: ((s: ProgramState) => void)[] = []
  private positions = new Map<string, Position>()

  /** @param autoAdvance saved setting (settings.json) restored at start. */
  constructor(
    private lib: Library,
    autoAdvance = false
  ) {
    this.activeEvent = lib.listEvents()[0]?.id ?? null
    this.current = this.normalize({ ...initialState, autoAdvance })
  }

  get state(): ProgramState {
    return this.current
  }

  get eventId(): string | null {
    return this.activeEvent
  }

  decks(): DeckMeta[] {
    return this.activeEvent ? this.lib.getDecks(this.activeEvent) : []
  }

  onChange(cb: (s: ProgramState) => void): void {
    this.listeners.push(cb)
  }

  dispatch(a: Action): ProgramState {
    // Actions arrive over IPC; an unknown type makes reduce return undefined.
    const next = reduce(this.current, a, this.decks()) as ProgramState | undefined
    return next ? this.commit(this.normalizeKv(next)) : this.current
  }

  /** Switch the active event. `shown` is never changed here (spec: output stays until the operator picks a slide). */
  setEvent(eventId: string): ProgramState {
    this.lib.getDecks(eventId) // throws (Indonesian message) if the event does not exist
    if (this.activeEvent) {
      this.positions.set(this.activeEvent, {
        deckId: this.current.deckId,
        index: this.current.index
      })
    }
    this.activeEvent = eventId
    const pos = this.positions.get(eventId) ?? { deckId: null, index: 0 }
    return this.commit(this.normalize({ ...this.current, ...pos }))
  }

  /** Re-validate after the library changed (deck added, removed or reordered). */
  refresh(): ProgramState {
    return this.commit(this.normalize(this.current))
  }

  /** Reorder the decks of an event; position and shown do not change. */
  reorderDecks(eventId: string, deckIds: string[]): ProgramState {
    this.lib.reorderDecks(eventId, deckIds)
    return this.refresh()
  }

  /**
   * Reorder the slides of a deck (`order[newIndex] = oldIndex`). The operator
   * position and the output stay on the same slides: `shown` keeps its image,
   * only its index changes.
   */
  reorderSlides(deckId: string, order: number[]): ProgramState {
    this.lib.reorderSlides(deckId, order) // validates; throws before anything changes
    for (const [ev, pos] of this.positions) {
      if (pos.deckId === deckId) {
        this.positions.set(ev, { ...pos, index: Math.max(0, order.indexOf(pos.index)) })
      }
    }
    return this.commit(this.normalize(followSlideOrder(this.current, deckId, order)))
  }

  /** URL of an event's stored KV, or null. */
  private kvUrlOf(eventId: string): string | null {
    const ev = this.lib.listEvents().find((e) => e.id === eventId)
    return ev?.kv ? kvImageUrl(ev.id, ev.kv) : null
  }

  /**
   * Set an event's KV image. The KV on air keeps its image when another event
   * changes; replacing the very image on air puts the new one on air.
   */
  setKv(eventId: string, srcPath: string): EventMeta {
    const before = this.kvUrlOf(eventId)
    const ev = this.lib.setKv(eventId, srcPath)
    const onAir = before !== null && before === this.current.kvUrl && kvOnAir(this.current)
    this.commit(
      this.normalize(onAir ? { ...this.current, kvUrl: kvImageUrl(eventId, ev.kv!) } : this.current)
    )
    return ev
  }

  /**
   * Remove an event's KV. If that image is on air the KV goes off; at STANDBY
   * the output becomes black instead of silently showing something else.
   */
  clearKv(eventId: string): EventMeta {
    const before = this.kvUrlOf(eventId)
    const ev = this.lib.clearKv(eventId)
    let s = this.current
    if (before !== null && before === s.kvUrl && kvOnAir(s)) {
      s = { ...s, kv: false, black: s.shown === null ? true : s.black, kvUrl: null }
    }
    this.commit(this.normalize(s))
    return ev
  }

  /** Remove a deck; if it is on the output, the output goes black. */
  removeDeck(eventId: string, deckId: string): ProgramState {
    this.lib.removeDeck(eventId, deckId)
    return this.refresh()
  }

  /** `shown` re-located in its deck (any event), or null when that slide is gone. */
  private locate(s: ProgramState): ProgramState['shown'] {
    if (!s.shown) return null
    try {
      return locateShown(s.shown, this.lib.getDeck(s.shown.deckId))
    } catch {
      return null
    }
  }

  /** URL of the active event's KV, or null (no event, no KV). */
  private activeKvUrl(): string | null {
    const ev = this.lib.listEvents().find((e) => e.id === this.activeEvent)
    return ev?.kv ? kvImageUrl(ev.id, ev.kv) : null
  }

  private normalize(s: ProgramState): ProgramState {
    // Position is reconciled against the active event only; if no valid deck,
    // reconcile moves it to the first ready deck at index 0 (no selectDeck, so
    // `shown` stays untouched).
    const pos = reconcile({ ...s, shown: null }, this.decks())
    // The KV belongs to the active event; KV on needs one (a removed KV turns it off).
    // The KV on air keeps its image when the event changes; otherwise the
    // active event's KV is applied.
    const kvUrl = kvOnAir(s) ? s.kvUrl : this.activeKvUrl()
    return { ...pos, shown: this.locate(s), kvUrl, kv: s.kv && kvUrl !== null }
  }

  /** After a dispatch: once the KV is no longer on air, apply the active event's KV. */
  private normalizeKv(s: ProgramState): ProgramState {
    if (kvOnAir(s)) return s
    const kvUrl = this.activeKvUrl()
    return kvUrl === s.kvUrl ? s : { ...s, kvUrl, kv: s.kv && kvUrl !== null }
  }

  private commit(next: ProgramState): ProgramState {
    if (same(next, this.current)) return this.current
    this.current = next
    for (const cb of this.listeners) cb(next)
    return next
  }
}
