import type { DeckMeta } from '../../shared/types'
import { pendingTake, type Action, type ProgramState } from '../../shared/program'

export type NextView =
  | { kind: 'none' }
  | { kind: 'slide'; deckId: string; index: number; notes: string }
  | { kind: 'end'; nextDeck: string | null }

export function currentDeck(decks: DeckMeta[], s: ProgramState): DeckMeta | null {
  const d = decks.find((x) => x.id === s.deckId)
  return d && d.slides.length > 0 ? d : null
}

/**
 * What the "Slide berikutnya" panel shows: the slide Next will put live. That is
 * the slide after the operator position, or the position itself while nothing
 * from this event is on the output (see `pendingTake`).
 */
export function nextIndex(decks: DeckMeta[], s: ProgramState): number {
  return pendingTake(s, decks) ? s.index : s.index + 1
}

export function nextView(decks: DeckMeta[], s: ProgramState): NextView {
  const deck = currentDeck(decks, s)
  if (!deck) return { kind: 'none' }
  if (pendingTake(s, decks)) {
    return { kind: 'slide', deckId: deck.id, index: s.index, notes: deck.slides[s.index].notes }
  }
  const nxt = deck.slides[s.index + 1]
  if (nxt) return { kind: 'slide', deckId: deck.id, index: s.index + 1, notes: nxt.notes }
  const pos = decks.indexOf(deck)
  const nd = decks.slice(pos + 1).find((d) => d.slides.length > 0)
  return { kind: 'end', nextDeck: nd ? nd.name : null }
}

export function canPrev(decks: DeckMeta[], s: ProgramState): boolean {
  const deck = currentDeck(decks, s)
  if (!deck) return false
  if (pendingTake(s, decks) || s.index > 0) return true
  return decks.slice(0, decks.indexOf(deck)).some((d) => d.slides.length > 0)
}

export type Tally = 'live' | 'frozen' | 'black' | 'idle'

export function tally(s: ProgramState): Tally {
  if (!s.shown) return 'idle'
  if (s.black) return 'black'
  if (s.frozen) return 'frozen'
  return 'live'
}

export const TALLY_TEXT: Record<Tally, string> = {
  live: 'LIVE',
  frozen: 'FROZEN',
  black: 'BLACK',
  idle: 'STANDBY'
}

interface KeyLike {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  repeat?: boolean
  target: EventTarget | null
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable
}

/** Keyboard shortcuts: Space/→ Next, ← Prev, F Freeze, B Black. Ignored while typing. */
export function keyToAction(e: KeyLike): Action | null {
  if (e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return null
  switch (e.key) {
    case ' ':
    case 'ArrowRight':
      return { type: 'next' }
    case 'ArrowLeft':
      return { type: 'prev' }
    case 'f':
    case 'F':
      return e.repeat ? null : { type: 'toggleFreeze' }
    case 'b':
    case 'B':
      return e.repeat ? null : { type: 'toggleBlack' }
    default:
      return null
  }
}

export type FileKind = 'pptx' | 'pdf' | 'unsupported'

export function fileKind(name: string): FileKind {
  if (/\.pptx?$/i.test(name)) return 'pptx'
  if (/\.pdf$/i.test(name)) return 'pdf'
  return 'unsupported'
}

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix so the user sees our message. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
}

export function baseName(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '')
}
