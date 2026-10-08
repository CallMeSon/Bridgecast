import type { DeckMeta } from '../../shared/types'
import { pendingTake, reduce, type Action, type ProgramState } from '../../shared/program'
import { slideUrl, type HdmiStatus } from '../../shared/ipc'
import type { HdmiSettings } from '../../shared/settings'

export type NextView =
  | { kind: 'none' }
  | {
      kind: 'slide'
      deckId: string
      index: number
      file: string
      notes: string
      /** Frozen: this is the operator position, what goes live on unfreeze (a preview). */
      held?: true
    }
  | { kind: 'end'; nextDeck: string | null; auto: boolean }

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
  const here = deck.slides[s.index]
  if (s.frozen && s.shown && here) {
    return {
      kind: 'slide',
      deckId: deck.id,
      index: s.index,
      file: here.file,
      notes: here.notes,
      held: true
    }
  }
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
  return { kind: 'end', nextDeck: nd ? nd.name : null, auto: s.autoAdvance }
}

/** An action is possible when the reducer changes the state (it returns the same object for a no-op). */
export function canNext(decks: DeckMeta[], s: ProgramState): boolean {
  return reduce(s, { type: 'next' }, decks) !== s
}

export function canPrev(decks: DeckMeta[], s: ProgramState): boolean {
  return reduce(s, { type: 'prev' }, decks) !== s
}

export type Tally = 'live' | 'frozen' | 'black' | 'kv' | 'idle'

export function tally(s: ProgramState): Tally {
  // KV on (pressed by the operator) is on air whatever else is going on. The
  // automatic KV while STANDBY keeps the STANDBY tally (nothing was taken yet).
  if (s.kv && s.kvUrl) return 'kv'
  if (!s.shown) return 'idle'
  if (s.black) return 'black'
  if (s.frozen) return 'frozen'
  return 'live'
}

export const TALLY_TEXT: Record<Tally, string> = {
  live: 'LIVE',
  frozen: 'FROZEN',
  black: 'BLACK',
  kv: 'KV',
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
  // Panels marked data-no-shortcuts (the output popover) own the keyboard: Space
  // there toggles a switch, it must not take the next slide live.
  if (el.closest?.('[data-no-shortcuts]')) return true
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable
}

/** Keyboard shortcuts: Space/→ Next, ← Prev, F Freeze, B Black, K KV. Ignored while typing. */
export function keyToAction(e: KeyLike): Action | null {
  if (e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return null
  switch (e.key) {
    case ' ':
    case 'ArrowRight':
    case 'PageDown': // presentation clickers
      return { type: 'next' }
    case 'ArrowLeft':
    case 'PageUp':
      return { type: 'prev' }
    case 'f':
    case 'F':
      return e.repeat ? null : { type: 'toggleFreeze' }
    case 'b':
    case 'B':
    case '.': // the "blank screen" button of many clickers
      return e.repeat ? null : { type: 'toggleBlack' }
    case 'k':
    case 'K':
      return e.repeat ? null : { type: 'toggleKv' }
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
 * What the Program output shows, for the HDMI window and the operator monitor:
 * null = black, otherwise an image URL. Black on is black. KV on (with a KV) is
 * the KV. Else the `shown` slide (never the operator position), also while
 * frozen. Else (STANDBY) the event's KV, or black without one.
 */
export function outputSource(s: ProgramState): string | null {
  if (s.black) return null
  if (s.kv && s.kvUrl) return s.kvUrl
  if (s.shown) return slideUrl(s.shown.deckId, s.shown.file)
  return s.kvUrl
}

export interface HdmiBadge {
  /** ok = green (window showing), off = gray, warn = amber (display unplugged), error = red. */
  tone: 'ok' | 'off' | 'warn' | 'error'
  text: string
}

/** Header HDMI status: green only when the window is actually on the second display. */
export function hdmiBadge(status: HdmiStatus | null, hdmi: HdmiSettings): HdmiBadge {
  if (!hdmi.enabled || status?.state === 'off') return { tone: 'off', text: 'HDMI mati' }
  if (status?.state === 'error') return { tone: 'error', text: 'HDMI bermasalah' }
  if (status?.state === 'showing') return { tone: 'ok', text: 'HDMI tampil' }
  if (status?.state === 'hidden' && !status.message) {
    return { tone: 'warn', text: 'HDMI tersembunyi' }
  }
  return { tone: 'off', text: 'HDMI memulai…' }
}

/** Status line of the HDMI section in the output popover. */
export function hdmiStatusText(status: HdmiStatus | null, hdmi: HdmiSettings): string {
  if (!hdmi.enabled || status?.state === 'off') return 'Mati'
  if (!status) return 'Memulai output HDMI…'
  if (status.message) return status.message
  if (status.state === 'showing') return 'Tampil'
  return 'Tersembunyi, layar tidak tersambung'
}
