import type { Library } from './library'
import type { DeckMeta } from '../shared/types'
import {
  followSlideOrder,
  initialState,
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
    a.transition === b.transition &&
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

  constructor(private lib: Library) {
    this.activeEvent = lib.listEvents()[0]?.id ?? null
    this.current = this.normalize(initialState)
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
    return next ? this.commit(next) : this.current
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

  private normalize(s: ProgramState): ProgramState {
    // Position is reconciled against the active event only; if no valid deck,
    // reconcile moves it to the first ready deck at index 0 (no selectDeck, so
    // `shown` stays untouched).
    const pos = reconcile({ ...s, shown: null }, this.decks())
    return { ...pos, shown: this.locate(s) }
  }

  private commit(next: ProgramState): ProgramState {
    if (same(next, this.current)) return this.current
    this.current = next
    for (const cb of this.listeners) cb(next)
    return next
  }
}
