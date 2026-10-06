import type { Library } from './library'
import type { DeckMeta } from '../shared/types'
import { initialState, reconcile, reduce, type Action, type ProgramState } from '../shared/program'

type Position = { deckId: string | null; index: number }

function same(a: ProgramState, b: ProgramState): boolean {
  return (
    a.deckId === b.deckId &&
    a.index === b.index &&
    a.frozen === b.frozen &&
    a.black === b.black &&
    a.transition === b.transition &&
    a.shown?.deckId === b.shown?.deckId &&
    a.shown?.index === b.shown?.index
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
    return this.commit(reduce(this.current, a, this.decks()))
  }

  /** Switch the active event. `shown` is never changed here (spec: output stays until the operator picks a slide). */
  setEvent(eventId: string): ProgramState {
    this.lib.getDecks(eventId) // throws (Indonesian message) if the event does not exist
    if (this.activeEvent) {
      this.positions.set(this.activeEvent, { deckId: this.current.deckId, index: this.current.index })
    }
    this.activeEvent = eventId
    const pos = this.positions.get(eventId) ?? { deckId: null, index: 0 }
    return this.commit(this.normalize({ ...this.current, ...pos }))
  }

  /** Re-validate after the library changed (deck added, removed or reordered). */
  refresh(): ProgramState {
    return this.commit(this.normalize(this.current))
  }

  private slideExists(deckId: string, index: number): boolean {
    try {
      this.lib.slidePath(deckId, index)
      return true
    } catch {
      return false
    }
  }

  private normalize(s: ProgramState): ProgramState {
    // Position is reconciled against the active event only; if no valid deck,
    // reconcile moves it to the first ready deck at index 0 (no selectDeck, so
    // `shown` stays untouched).
    const pos = reconcile({ ...s, shown: null }, this.decks())
    const shown = s.shown && this.slideExists(s.shown.deckId, s.shown.index) ? s.shown : null
    return { ...pos, shown }
  }

  private commit(next: ProgramState): ProgramState {
    if (same(next, this.current)) return this.current
    this.current = next
    for (const cb of this.listeners) cb(next)
    return next
  }
}
