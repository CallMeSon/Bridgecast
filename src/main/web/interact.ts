/**
 * Interact: the switch that lets a live web page take the operator's clicks, wheel and
 * keys. One switch per deck, owned by the window that turned it on. It is kept only for
 * the deck on air, in the open event, and only while its owner is open: main calls
 * `sync` after every Program change and `releaseOwner` when that window closes or
 * navigates, so a stale renderer can never keep it on. Pure: no Electron here.
 */
export class InteractSwitches<Owner> {
  private owners = new Map<string, Owner>()
  /** The event the switches belong to; undefined until the first `sync`. */
  private event: string | null | undefined = undefined

  /** Turns the switch on for a deck, owned by `owner` (the window that asked). */
  set(deckId: string, owner: Owner): void {
    this.owners.set(deckId, owner)
  }

  /** Turns the switch off for a deck. */
  clear(deckId: string): void {
    this.owners.delete(deckId)
  }

  has(deckId: string): boolean {
    return this.owners.has(deckId)
  }

  /** Drops every switch that `owner` turned on (its window closed or navigated). */
  releaseOwner(owner: Owner): void {
    for (const [deckId, o] of this.owners) if (o === owner) this.owners.delete(deckId)
  }

  /**
   * After a Program change: all switches go when the open event changed, and each one
   * stays only while its deck is the one on air.
   */
  sync(eventId: string | null, onAir: string | null): void {
    if (eventId !== this.event) {
      this.owners.clear()
      this.event = eventId
    }
    for (const deckId of [...this.owners.keys()]) {
      if (deckId !== onAir) this.owners.delete(deckId)
    }
  }
}
