import type { Tally, WebChipKind } from '../model'

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

export interface WebRowParts {
  /** Show the on-air state tag. */
  tag: DeckRowTag | null
  /** Show the web chip with this kind, or none. */
  chip: WebChipKind | null
}

/**
 * What the right side of a web deck row shows. On air, the state tag says more than a Ready
 * chip, so Ready gives way. Loading, Error and HOLD stay beside the tag: HOLD is never
 * hidden on air.
 */
export function webRowParts(tag: DeckRowTag | null, chip: WebChipKind): WebRowParts {
  if (tag === null) return { tag: null, chip }
  return { tag, chip: chip === 'ready' ? null : chip }
}
