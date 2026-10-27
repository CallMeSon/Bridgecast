import type { DeckMeta, SectionMeta } from '../../shared/types'
import type { DeckFit } from '../../shared/canvas'
import { kvOnAir, pendingTake, reduce, type Action, type ProgramState } from '../../shared/program'
import { segmentsOf } from '../../shared/sections'
import { slideUrl, type HdmiStatus } from '../../shared/ipc'
import { DEFAULT_AUDIO, type AudioSettings, type HdmiSettings } from '../../shared/settings'
import { DEFAULT_DECK_AUDIO, effectiveGain, type DeckAudio } from '../../shared/audio-levels'

export type NextView =
  | { kind: 'none' }
  | {
      kind: 'slide'
      deckId: string
      index: number
      file: string
      notes: string
      /** The slide is a video slide. */
      video?: true
      /** Frozen: this is the operator position, a preview only (unfreeze keeps the held slide live). */
      held?: true
    }
  | { kind: 'end'; nextDeck: string | null; auto: boolean }
  /** Auto advance stops at the end of a section; `nextSection` is the next section with slides. */
  | { kind: 'sectionEnd'; nextSection: string | null }

export function currentDeck(decks: DeckMeta[], s: ProgramState): DeckMeta | null {
  const d = decks.find((x) => x.id === s.deckId)
  return d && d.slides.length > 0 ? d : null
}

/**
 * What the "Up next" panel shows: the slide Next will put live. That is
 * the slide after the operator position, or the position itself while nothing
 * from this event is on the output (see `pendingTake`).
 */
export function nextIndex(decks: DeckMeta[], s: ProgramState): number {
  return pendingTake(s, decks) ? s.index : s.index + 1
}

export function nextView(
  decks: DeckMeta[],
  s: ProgramState,
  sections: SectionMeta[] = []
): NextView {
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
      ...(here.video ? { video: true as const } : {}),
      held: true
    }
  }
  if (pendingTake(s, decks)) {
    const cur = deck.slides[s.index]
    return {
      kind: 'slide',
      deckId: deck.id,
      index: s.index,
      file: cur.file,
      notes: cur.notes,
      ...(cur.video ? { video: true as const } : {})
    }
  }
  const nxt = deck.slides[s.index + 1]
  if (nxt) {
    return {
      kind: 'slide',
      deckId: deck.id,
      index: s.index + 1,
      file: nxt.file,
      notes: nxt.notes,
      ...(nxt.video ? { video: true as const } : {})
    }
  }
  if (sections.length > 0 && s.autoAdvance) {
    const segs = segmentsOf(decks, sections)
    const si = segs.findIndex((seg) => seg.decks.includes(deck))
    if (si >= 0) {
      const inSegment = segs[si].decks
      const later = inSegment.slice(inSegment.indexOf(deck) + 1)
      if (!later.some((d) => d.slides.length > 0)) {
        const ns = segs.slice(si + 1).find((seg) => seg.decks.some((d) => d.slides.length > 0))
        return { kind: 'sectionEnd', nextSection: ns?.section?.name ?? null }
      }
    }
  }
  const pos = decks.indexOf(deck)
  const nd = decks.slice(pos + 1).find((d) => d.slides.length > 0)
  return { kind: 'end', nextDeck: nd ? nd.name : null, auto: s.autoAdvance }
}

/** An action is possible when the reducer changes the state (it returns the same object for a no-op). */
export function canNext(decks: DeckMeta[], s: ProgramState, sections: SectionMeta[] = []): boolean {
  return reduce(s, { type: 'next' }, decks, sections) !== s
}

export function canPrev(decks: DeckMeta[], s: ProgramState, sections: SectionMeta[] = []): boolean {
  return reduce(s, { type: 'prev' }, decks, sections) !== s
}

export function canNextSection(
  decks: DeckMeta[],
  s: ProgramState,
  sections: SectionMeta[]
): boolean {
  return reduce(s, { type: 'nextSection' }, decks, sections) !== s
}

export function canPrevSection(
  decks: DeckMeta[],
  s: ProgramState,
  sections: SectionMeta[]
): boolean {
  return reduce(s, { type: 'prevSection' }, decks, sections) !== s
}

export type Tally = 'live' | 'frozen' | 'black' | 'kv' | 'idle'

export function tally(s: ProgramState): Tally {
  // KV on (pressed by the operator) is on air whatever else is going on. The
  // automatic KV while STANDBY keeps the STANDBY tally (nothing was taken yet).
  if (s.kv && kvOnAir(s)) return 'kv'
  // STANDBY goes black only when the operator turned the automatic KV off (K).
  if (!s.shown) return s.black && s.kvUrl !== null ? 'black' : 'idle'
  if (s.black) return 'black'
  if (s.frozen) return 'frozen'
  return 'live'
}

/**
 * Changing the canvas resizes what the audience sees, so it needs a confirm
 * unless nothing of the show is visible: STANDBY and BLACK show no slide.
 */
export function needsCanvasConfirm(s: ProgramState): boolean {
  const t = tally(s)
  return t !== 'idle' && t !== 'black'
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
  shiftKey?: boolean
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

/** Keyboard shortcuts: Space/→ Next, ← Prev, F Freeze, B Black, K KV, N next section, Shift+N previous section. Ignored while typing. */
export function keyToAction(e: KeyLike): Action | null {
  if (e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return null
  // A held key (or a clicker that auto-repeats) must never skip slides: every
  // action fires once per physical press.
  if (e.repeat) return null
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
      return { type: 'toggleFreeze' }
    case 'b':
    case 'B':
    case '.': // the "blank screen" button of many clickers
      return { type: 'toggleBlack' }
    case 'k':
    case 'K':
      return { type: 'toggleKv' }
    case 'n':
    case 'N':
      // Shift decides, never the case: Caps Lock sends 'N' without Shift.
      return { type: e.shiftKey ? 'prevSection' : 'nextSection' }
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
  meta: 'Unsupported',
  file: 'Only PPTX, PPT, or PDF files can be imported.'
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
  return percent <= 0 ? 'Queued' : 'Converting'
}

/** Strip Electron's "Error invoking remote method 'x': Error: " prefix so the user sees our message. */
export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
}

/** "3 slides", "1 deck": a count with its noun, pluralised. */
export function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export function baseName(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '')
}

/**
 * What is on the Program output. A video slide carries its PNG as `poster` (its
 * last frame) and the `take` that put it live, so each window plays a take once.
 */
export type OutputMedia =
  | { kind: 'image'; url: string; fit: DeckFit }
  | { kind: 'video'; url: string; poster: string; take: number; fit: DeckFit }

/**
 * What the Program output shows, for the HDMI window and the operator monitor:
 * null = black. Black on is black. KV on (with a KV) is the KV. Else the `shown`
 * slide (never the operator position), also while frozen: a video when it has
 * one, else its image. Else (STANDBY) the event's KV, or black without one.
 * The `shown` slide carries its deck's `fit` (missing = `fit`); the KV is always `fit`.
 */
export function outputSource(s: ProgramState): OutputMedia | null {
  if (s.black) return null
  if (s.kv && s.kvUrl) return { kind: 'image', url: s.kvUrl, fit: 'fit' }
  if (s.shown) {
    const { deckId, file, video } = s.shown
    const fit = s.shown.fit ?? 'fit'
    const poster = slideUrl(deckId, file)
    return video
      ? { kind: 'video', url: slideUrl(deckId, video), poster, take: s.take, fit }
      : { kind: 'image', url: poster, fit }
  }
  return s.kvUrl ? { kind: 'image', url: s.kvUrl, fit: 'fit' } : null
}

/**
 * Gain (0–1) of the output's video sound: the live deck's level times the
 * master. Settings not known yet (null) count as the defaults, so only the
 * deck level applies; the output stays muted separately until they arrive.
 */
export function outputGain(s: ProgramState, audio: AudioSettings | null): number {
  return effectiveGain(s.shown?.audio ?? DEFAULT_DECK_AUDIO, audio ?? DEFAULT_AUDIO)
}

export interface HdmiBadge {
  /** ok = green (window showing), off = gray, warn = amber (display unplugged), error = red. */
  tone: 'ok' | 'off' | 'warn' | 'error'
  text: string
}

/** Header HDMI status: green only when the window is actually on the second display. */
export function hdmiBadge(status: HdmiStatus | null, hdmi: HdmiSettings): HdmiBadge {
  if (!hdmi.enabled || status?.state === 'off') return { tone: 'off', text: 'HDMI off' }
  if (status?.state === 'error') return { tone: 'error', text: 'HDMI error' }
  if (status?.state === 'showing') return { tone: 'ok', text: 'HDMI live' }
  if (status?.state === 'hidden' && !status.message) {
    return { tone: 'warn', text: 'HDMI hidden' }
  }
  return { tone: 'off', text: 'HDMI starting…' }
}

/** Status line of the HDMI section in the output popover. */
export function hdmiStatusText(status: HdmiStatus | null, hdmi: HdmiSettings): string {
  if (!hdmi.enabled || status?.state === 'off') return 'Off'
  if (!status) return 'Starting HDMI output…'
  if (status.message) return status.message
  if (status.state === 'showing') return 'Live'
  return 'Hidden, display not connected'
}

/** Role of a thumbnail in the strip (frozen: the slide still on air while Freeze holds the output). */
export type SlideRole = 'live' | 'frozen' | 'next' | 'pos'

const ROLE_TEXT: Record<SlideRole, string> = {
  live: 'live',
  frozen: 'frozen',
  next: 'next',
  pos: 'operator position'
}

/** Accessible name of a thumbnail: number plus role, so a screen reader hears what is on air. */
export function slideLabel(index: number, role: SlideRole | undefined): string {
  return role ? `Slide ${index + 1}, ${ROLE_TEXT[role]}` : `Slide ${index + 1}`
}

/**
 * Role of slide `i` of `deckId`. The slide on air (`shown`) is LIVE, or FROZEN
 * while Freeze holds it: it outranks next and the operator position.
 */
export function slideRole(
  decks: DeckMeta[],
  s: ProgramState,
  deckId: string,
  i: number
): SlideRole | undefined {
  const t = tally(s)
  if (s.shown && s.shown.deckId === deckId && s.shown.index === i) {
    if (t === 'live') return 'live'
    if (t === 'frozen') return 'frozen'
  }
  if (s.deckId === deckId) {
    if (i === nextIndex(decks, s)) return 'next'
    if (i === s.index) return 'pos'
  }
  return undefined
}

/**
 * Alt+arrow reorder: the target index for a focused item, or null when the key
 * is not a reorder key for this axis or the item is already at that end.
 */
export function reorderTarget(
  key: string,
  axis: 'vertical' | 'horizontal',
  index: number,
  count: number
): number | null {
  const [back, fwd] = axis === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  const to = key === back ? index - 1 : key === fwd ? index + 1 : null
  return to !== null && to >= 0 && to < count ? to : null
}

/** Roving focus inside a menu: the index to focus for a key, or null for other keys. */
export function menuFocusTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * Words for a deck whose sound is not the default (shown on its row, so the
 * operator sees it without opening the menu); null while it plays at full volume.
 * Muted wins over the volume, because that is what the audience hears.
 */
export function deckSoundLabel(a: DeckAudio | undefined): string | null {
  if (!a) return null
  if (a.muted) return 'Deck sound: muted'
  return a.volume === DEFAULT_DECK_AUDIO.volume ? null : `Deck sound: ${a.volume}%`
}

/** Short confirmations shown in a polite live region. */
export const SAVED = { kv: 'KV saved', order: 'Order saved' } as const
