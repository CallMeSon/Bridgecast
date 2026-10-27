import type { DeckMeta, SectionMeta } from './types'
import { segmentsOf } from './sections'
import { DEFAULT_CANVAS, sanitizeFit, type DeckFit, type ResolvedCanvas } from './canvas'
import { DEFAULT_DECK_AUDIO, sanitizeDeckAudio, type DeckAudio } from './audio-levels'

/**
 * The slide on the output. `file` is the slide's image in its deck and never
 * changes for that slide; `index` is where it currently sits in the deck. After
 * the deck's slides are reordered `shown` follows the slide (same file, new
 * index), so the output keeps showing the same image.
 */
export interface ShownSlide {
  deckId: string
  index: number
  file: string
  /** The slide's MP4 in its deck, when it is a video slide. */
  video?: string
  /**
   * How the slide's deck fills the canvas and how loud its video plays. Copied
   * from the deck when the slide goes live and refreshed by `locateShown`, so
   * changing them never changes `take`. Absent on state from before they existed.
   */
  fit?: DeckFit
  audio?: DeckAudio
  /** Set when the slide is the page of a web deck. */
  web?: { deckId: string }
}

export interface ProgramState {
  deckId: string | null
  index: number
  shown: ShownSlide | null
  frozen: boolean
  black: boolean
  /**
   * The event's KV image is on the output (operator pressed KV). Never on with
   * `black`. While STANDBY the KV also shows by itself, without this flag.
   */
  kv: boolean
  /**
   * URL of the active event's KV image, or null. Set by main from the event's
   * KV, never by the reducer.
   */
  kvUrl: string | null
  transition: 'cut' | 'fade'
  /**
   * Next on the last slide goes on to the next deck (and Prev on the first
   * slide back to the previous one). Off: navigation stays inside the live
   * deck, so a speaker's clicker cannot run into the next presentation.
   */
  autoAdvance: boolean
  /**
   * Counts every take (a slide put live, also the one already live), so a video
   * slide replays on a repeated take. Not changed by freeze, black, KV, etc.
   */
  take: number
  /**
   * The live web page lost its connection and the output holds its last good
   * frame. Set by main, never by the reducer; cleared by taking another deck,
   * KV, black or `resumeWeb`.
   */
  webHold: boolean
  /**
   * The canvas of the active event (its override, else the machine default).
   * Set by main, never by the reducer.
   */
  canvas: ResolvedCanvas
}

export type Action =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }
  | { type: 'selectDeck'; deckId: string }
  | { type: 'toggleFreeze' }
  | { type: 'toggleBlack' }
  | { type: 'toggleKv' }
  | { type: 'setTransition'; transition: 'cut' | 'fade' }
  | { type: 'setAutoAdvance'; on: boolean }
  | { type: 'nextSection' }
  | { type: 'prevSection' }
  | { type: 'selectSection'; sectionId: string }
  | { type: 'nextDeck' }
  | { type: 'prevDeck' }
  | { type: 'resumeWeb' }

type DeckLike = Pick<DeckMeta, 'id' | 'slides' | 'fit' | 'audio'> &
  Partial<Pick<DeckMeta, 'source' | 'web'>>

/**
 * The KV image is on the output: not black, there is a KV, and it was pressed
 * (kv) or nothing is shown (STANDBY shows the KV by itself).
 */
export function kvOnAir(s: ProgramState): boolean {
  return !s.black && s.kvUrl !== null && (s.kv || s.shown === null)
}

export const initialState: ProgramState = {
  deckId: null,
  index: 0,
  shown: null,
  frozen: false,
  black: false,
  kv: false,
  kvUrl: null,
  transition: 'cut',
  autoAdvance: false,
  take: 0,
  webHold: false,
  canvas: { ...DEFAULT_CANVAS, origin: 'default' }
}

/** Move the operator position (index must exist in deck); `shown` follows unless frozen. */
function moveTo(state: ProgramState, deck: DeckLike, index: number): ProgramState {
  const slide = deck.slides[index]
  const shown: ShownSlide = {
    deckId: deck.id,
    index,
    file: slide.file,
    fit: sanitizeFit(deck.fit),
    audio: sanitizeDeckAudio(deck.audio)
  }
  if (slide.video) shown.video = slide.video
  if (deck.source === 'web') shown.web = { deckId: deck.id }
  // Taking a deck other than the one on air ends a web hold.
  const leaves = !state.frozen && state.shown?.deckId !== deck.id
  return {
    ...state,
    webHold: leaves ? false : state.webHold,
    deckId: deck.id,
    index,
    shown: state.frozen ? state.shown : shown,
    take: state.frozen ? state.take : state.take + 1
  }
}

/**
 * Index into `segmentsOf(decks, sections)` of the segment holding `deckId`, or -1
 * (no deck, or a deck that is not in `decks`).
 */
export function segmentOfDeck<D extends DeckLike>(
  decks: D[],
  sections: SectionMeta[],
  deckId: string | null
): number {
  if (deckId === null) return -1
  return segmentsOf(decks, sections).findIndex((seg) => seg.decks.some((d) => d.id === deckId))
}

function step(
  state: ProgramState,
  decks: DeckLike[],
  sections: SectionMeta[],
  dir: 1 | -1
): ProgramState {
  // Auto advance runs on through the decks of the live deck's section only.
  const segment = segmentsOf(decks, sections).find((seg) =>
    seg.decks.some((d) => d.id === state.deckId)
  )
  const flat: { deck: DeckLike; index: number }[] = []
  const source =
    state.autoAdvance && segment ? segment.decks : decks.filter((x) => x.id === state.deckId)
  for (const d of source) {
    for (let i = 0; i < d.slides.length; i++) flat.push({ deck: d, index: i })
  }
  const pos = flat.findIndex((p) => p.deck.id === state.deckId && p.index === state.index)
  if (pos < 0) return state
  const target = flat[pos + dir]
  if (!target) return state
  return moveTo(state, target.deck, target.index)
}

/**
 * Puts slide 0 of the first deck with slides in the segment `from + dir`, `from + 2 * dir`, …
 * live (forward from a pending take: `from` itself first). Same state object when there is
 * no such segment.
 */
function jumpSection(
  state: ProgramState,
  decks: DeckLike[],
  sections: SectionMeta[],
  dir: 1 | -1
): ProgramState {
  // Without sections there is nothing to jump between.
  if (sections.length === 0) return state
  const segments = segmentsOf(decks, sections)
  const from =
    state.deckId === null
      ? -1
      : segments.findIndex((seg) => seg.decks.some((d) => d.id === state.deckId))
  // Nothing of these decks is on air yet (STANDBY with a valid position): going
  // forward starts at the position's own segment, so its first slide is not skipped.
  const start = dir === 1 && from >= 0 && pendingTake(state, decks) ? from : from + dir
  for (let i = start; i >= 0 && i < segments.length; i += dir) {
    const deck = segments[i].decks.find((d) => d.slides.length > 0)
    if (deck) return moveTo(state, deck, 0)
  }
  return state
}

/**
 * Where `shown` is now in its deck: the same slide file, at whatever index it
 * has after a reorder, with the deck's current fit and audio; null when the deck
 * or that slide is gone. Returns the same object when nothing changed, and never
 * touches `take` (it is not part of `shown`), so a fit or volume change does not
 * replay a video slide.
 */
export function locateShown(
  shown: ShownSlide | null,
  deck: DeckLike | undefined
): ShownSlide | null {
  if (!shown || !deck || deck.id !== shown.deckId) return null
  const index =
    deck.slides[shown.index]?.file === shown.file
      ? shown.index
      : deck.slides.findIndex((s) => s.file === shown.file)
  if (index < 0) return null
  const fit = sanitizeFit(deck.fit)
  const audio = sanitizeDeckAudio(deck.audio)
  const had = shown.audio ?? DEFAULT_DECK_AUDIO
  if (
    index === shown.index &&
    (shown.fit ?? 'fit') === fit &&
    had.volume === audio.volume &&
    had.muted === audio.muted
  ) {
    return shown
  }
  return { ...shown, index, fit, audio }
}

function isPermutation(order: number[], n: number): boolean {
  return (
    Array.isArray(order) &&
    order.length === n &&
    new Set(order).size === n &&
    order.every((i) => Number.isInteger(i) && i >= 0 && i < n)
  )
}

/**
 * The slides of `deckId` were reordered: `order[newIndex] = oldIndex`. The
 * operator position and `shown` stay on the same slides (their indices are
 * remapped); nothing else changes.
 */
export function followSlideOrder(
  state: ProgramState,
  deckId: string,
  order: number[]
): ProgramState {
  const remap = (i: number): number => {
    const n = order.indexOf(i)
    return n < 0 ? i : n
  }
  let maxIndex = -1
  if (state.deckId === deckId) maxIndex = Math.max(maxIndex, state.index)
  if (state.shown?.deckId === deckId) maxIndex = Math.max(maxIndex, state.shown.index)
  if (maxIndex < 0 || !isPermutation(order, order.length) || maxIndex >= order.length) return state
  const index = state.deckId === deckId ? remap(state.index) : state.index
  const shown =
    state.shown && state.shown.deckId === deckId
      ? { ...state.shown, index: remap(state.shown.index) }
      : state.shown
  if (index === state.index && shown?.index === state.shown?.index) return state
  return { ...state, index, shown }
}

/**
 * True when the output shows nothing from these decks (STANDBY, or a slide left
 * over from another event) while the operator position is valid and not frozen.
 * Then Next/Prev first take the current position live instead of stepping, so
 * the slide at the position is never skipped. Shared with the renderer so the
 * "Slide berikutnya" panel shows what Next will actually put live.
 */
export function pendingTake(state: ProgramState, decks: DeckLike[]): boolean {
  if (state.frozen || state.deckId === null) return false
  const shown = state.shown
  if (shown && decks.some((d) => d.id === shown.deckId)) return false
  const deck = decks.find((d) => d.id === state.deckId)
  return (
    !!deck && Number.isInteger(state.index) && state.index >= 0 && state.index < deck.slides.length
  )
}

/** True when the operator deck is a web deck and the output follows the operator (not frozen). */
function onLiveWebDeck(state: ProgramState, decks: DeckLike[]): boolean {
  if (state.frozen) return false
  return decks.some((d) => d.id === state.deckId && d.source === 'web')
}

/**
 * The arrow key to forward to the page for a Next/Prev action: only while the
 * output shows a web deck that is also the operator deck and not frozen.
 */
export function webKey(
  state: ProgramState,
  decks: DeckLike[],
  action: Action
): 'ArrowRight' | 'ArrowLeft' | null {
  if (action.type !== 'next' && action.type !== 'prev') return null
  if (!state.shown?.web || state.shown.deckId !== state.deckId) return null
  if (!onLiveWebDeck(state, decks)) return null
  return action.type === 'next' ? 'ArrowRight' : 'ArrowLeft'
}

/**
 * Slide 0 of the next (or previous) deck with slides, in event order; same state at the ends.
 * Forward from a pending take (nothing of these decks on air, e.g. after an event switch):
 * the position's own deck first, the deck Next would take.
 */
function stepDeck(state: ProgramState, decks: DeckLike[], dir: 1 | -1): ProgramState {
  const from = decks.findIndex((d) => d.id === state.deckId)
  if (from < 0) return state
  if (dir === 1 && pendingTake(state, decks)) return moveTo(state, decks[from], 0)
  for (let i = from + dir; i >= 0 && i < decks.length; i += dir) {
    if (decks[i].slides.length > 0) return moveTo(state, decks[i], 0)
  }
  return state
}

export function reduce(
  state: ProgramState,
  action: Action,
  decks: DeckLike[],
  sections: SectionMeta[] = []
): ProgramState {
  switch (action.type) {
    case 'next':
    case 'prev':
      if (pendingTake(state, decks)) {
        return moveTo(
          state,
          decks.find((d) => d.id === state.deckId)!,
          state.index
        )
      }
      // A live web page owns its own navigation: Next/Prev never move the position.
      if (onLiveWebDeck(state, decks)) return state
      return step(state, decks, sections, action.type === 'next' ? 1 : -1)
    case 'nextDeck':
    case 'prevDeck':
      return stepDeck(state, decks, action.type === 'nextDeck' ? 1 : -1)
    case 'resumeWeb':
      return state.webHold ? { ...state, webHold: false } : state
    case 'goto': {
      const deck = decks.find((d) => d.id === state.deckId)
      if (!deck || !Number.isInteger(action.index)) return state
      if (action.index < 0 || action.index >= deck.slides.length) return state
      return moveTo(state, deck, action.index)
    }
    case 'selectDeck': {
      const deck = decks.find((d) => d.id === action.deckId)
      if (!deck || deck.slides.length === 0) return state
      return moveTo(state, deck, 0)
    }
    case 'nextSection':
    case 'prevSection':
      return jumpSection(state, decks, sections, action.type === 'nextSection' ? 1 : -1)
    case 'selectSection': {
      if (sections.length === 0) return state
      const seg = segmentsOf(decks, sections).find((x) => x.section?.id === action.sectionId)
      const deck = seg?.decks.find((d) => d.slides.length > 0)
      return deck ? moveTo(state, deck, 0) : state
    }
    case 'toggleFreeze': {
      // Freezing only means something while a slide is on air.
      if (!state.frozen) return state.shown === null ? state : { ...state, frozen: true }
      // Unfreeze: the output stays on the slide that was held, and the operator
      // position returns to it, so Next goes on from what is on air. A live
      // slide outside these decks (or STANDBY): only the freeze is cleared.
      const live = locateShown(
        state.shown,
        decks.find((d) => d.id === state.shown?.deckId)
      )
      if (!live) return { ...state, frozen: false }
      return { ...state, frozen: false, deckId: live.deckId, index: live.index, shown: live }
    }
    case 'toggleBlack':
      return { ...state, black: !state.black, kv: state.black ? state.kv : false, webHold: false }
    case 'toggleKv':
      // Off: the KV on air goes away. At STANDBY the KV shows by itself, so the
      // output only really leaves it when it goes black.
      if (kvOnAir(state)) {
        return {
          ...state,
          kv: false,
          black: state.shown === null ? true : state.black,
          webHold: false
        }
      }
      if (state.kvUrl === null) return state.kv ? { ...state, kv: false, webHold: false } : state
      return { ...state, kv: true, black: false, webHold: false }
    case 'setTransition':
      return { ...state, transition: action.transition }
    case 'setAutoAdvance':
      return typeof action.on === 'boolean' ? { ...state, autoAdvance: action.on } : state
  }
}

/**
 * Re-validate after the decks changed (added, removed, reordered): `shown`
 * follows its slide or is dropped (output goes black) when the slide is gone;
 * the operator position is clamped, or moved to the first ready deck.
 */
export function reconcile(state: ProgramState, decks: DeckLike[]): ProgramState {
  const shown = state.shown
    ? locateShown(
        state.shown,
        decks.find((x) => x.id === state.shown!.deckId)
      )
    : null

  let deckId = state.deckId
  let index = state.index
  const cur = decks.find((d) => d.id === deckId)
  if (!cur || cur.slides.length === 0) {
    const first = decks.find((d) => d.slides.length > 0)
    deckId = first ? first.id : null
    index = 0
  } else if (index >= cur.slides.length) {
    index = cur.slides.length - 1
  } else if (index < 0) {
    index = 0
  }

  // A freeze with nothing on air or no operator deck has nothing to preview.
  const frozen = state.frozen && shown !== null && cur !== undefined
  if (
    deckId === state.deckId &&
    index === state.index &&
    shown === state.shown &&
    frozen === state.frozen
  )
    return state
  return { ...state, deckId, index, shown, frozen }
}
