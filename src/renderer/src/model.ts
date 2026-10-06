import type { DeckMeta } from '../../shared/types'
import { pendingTake, type Action, type ProgramState } from '../../shared/program'
import { slideUrl, type NdiStatus } from '../../shared/ipc'
import type { NdiSettings } from '../../shared/settings'

export type NextView =
  | { kind: 'none' }
  | { kind: 'slide'; deckId: string; index: number; file: string; notes: string }
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
    const cur = deck.slides[s.index]
    return { kind: 'slide', deckId: deck.id, index: s.index, file: cur.file, notes: cur.notes }
  }
  const nxt = deck.slides[s.index + 1]
  if (nxt) {
    return { kind: 'slide', deckId: deck.id, index: s.index + 1, file: nxt.file, notes: nxt.notes }
  }
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
  const el = target as {
    tagName?: string
    isContentEditable?: boolean
    closest?: (sel: string) => unknown
  } | null
  if (!el) return false
  // Panels marked data-no-shortcuts (the NDI popover) own the keyboard: Space
  // there toggles a switch, it must not take the next slide live.
  if (el.closest?.('[data-no-shortcuts]')) return true
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

/** Copy for a dropped or picked item that cannot be imported (an error row). */
export const UNSUPPORTED = {
  meta: 'Tidak didukung',
  file: 'Hanya file PPTX, PPT, atau PDF yang bisa diimpor.',
  folder: 'Folder tidak diimpor. Buka foldernya, lalu seret file PPTX, PPT, atau PDF di dalamnya.'
} as const

/** True when a drag carries files from outside (Explorer), not a deck or slide being reordered. */
export function hasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes('Files')
}

/**
 * Move one item from index `from` to index `to` (as in the mockup: take it
 * out, insert it at `to`). Returns a new array; invalid indices return a copy.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from === to || !(from in next) || !(to in next)) return next
  const [m] = next.splice(from, 1)
  next.splice(to, 0, m)
  return next
}

/** Order for `slides:reorder` after moving slide `from` to `to`: order[newIndex] = oldIndex. */
export function moveOrder(n: number, from: number, to: number): number[] {
  return moveItem(
    Array.from({ length: n }, (_, i) => i),
    from,
    to
  )
}

/** Status text of a busy import row: queued (0 %) or converting. */
export function importMeta(percent: number): string {
  return percent <= 0 ? 'Menunggu' : 'Mengonversi'
}

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix so the user sees our message. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
}

export function baseName(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '')
}

/**
 * What the Program output shows: the `shown` slide (never the operator
 * position), or null for black (Black on, or nothing shown yet).
 */
export function outputSource(s: ProgramState): string | null {
  if (s.black || !s.shown) return null
  return slideUrl(s.shown.deckId, s.shown.file)
}

export interface NdiBadge {
  /** ok = green (sender running), off = gray, error = red. */
  tone: 'ok' | 'off' | 'error'
  name: string | null
  detail: string
}

/** Header NDI status: green only when the sender actually runs. */
export function ndiBadge(status: NdiStatus | null, ndi: NdiSettings): NdiBadge {
  if (!ndi.enabled) return { tone: 'off', name: null, detail: 'nonaktif' }
  if (status?.state === 'error') return { tone: 'error', name: ndi.name, detail: 'bermasalah' }
  if (status?.state === 'running') {
    return { tone: 'ok', name: ndi.name, detail: `${ndi.width}×${ndi.height} · ${ndi.fps} fps` }
  }
  return { tone: 'off', name: ndi.name, detail: 'memulai…' }
}
