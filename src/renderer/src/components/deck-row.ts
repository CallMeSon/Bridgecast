import type { Tally } from '../model'

export type DeckRowTag = 'live' | 'frozen' | 'black' | 'kv'

/**
 * The on-air tag of a deck row. Only the deck that is on the output (`shownDeckId`) carries
 * one, whatever the state: LIVE, FROZEN, BLACK or KV. A standby Program, or any other deck,
 * has none.
 */
export function deckRowTag(
  deckId: string,
  shownDeckId: string | null,
  t: Tally
): DeckRowTag | null {
  if (shownDeckId === null || deckId !== shownDeckId) return null
  return t === 'idle' ? null : t
}
