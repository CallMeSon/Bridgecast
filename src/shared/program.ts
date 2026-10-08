import type { DeckMeta } from './types'

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
}

export interface ProgramState {
  deckId: string | null
  index: number
  shown: ShownSlide | null
  frozen: boolean
  black: boolean
  transition: 'cut' | 'fade'
  /**
   * Next on the last slide goes on to the next deck (and Prev on the first
   * slide back to the previous one). Off: navigation stays inside the live
   * deck, so a speaker's clicker cannot run into the next presentation.
   */
  autoAdvance: boolean
}

export type Action =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }
  | { type: 'selectDeck'; deckId: string }
  | { type: 'toggleFreeze' }
  | { type: 'toggleBlack' }
  | { type: 'setTransition'; transition: 'cut' | 'fade' }
  | { type: 'setAutoAdvance'; on: boolean }

type DeckLike = Pick<DeckMeta, 'id' | 'slides'>

export const initialState: ProgramState = {
  deckId: null,
  index: 0,
  shown: null,
  frozen: false,
  black: false,
  transition: 'cut',
  autoAdvance: false
}

/** Move the operator position (index must exist in deck); `shown` follows unless frozen. */
function moveTo(state: ProgramState, deck: DeckLike, index: number): ProgramState {
  return {
    ...state,
    deckId: deck.id,
    index,
    shown: state.frozen ? state.shown : { deckId: deck.id, index, file: deck.slides[index].file }
  }
}

function step(state: ProgramState, decks: DeckLike[], dir: 1 | -1): ProgramState {
  const flat: { deck: DeckLike; index: number }[] = []
  for (const d of state.autoAdvance ? decks : decks.filter((x) => x.id === state.deckId)) {
    for (let i = 0; i < d.slides.length; i++) flat.push({ deck: d, index: i })
  }
  const pos = flat.findIndex((p) => p.deck.id === state.deckId && p.index === state.index)
  if (pos < 0) return state
  const target = flat[pos + dir]
  if (!target) return state
  return moveTo(state, target.deck, target.index)
}

/**
 * Where `shown` is now in its deck: the same slide file, at whatever index it
 * has after a reorder; null when the deck or that slide is gone. Returns the
 * same object when nothing changed.
 */
export function locateShown(
  shown: ShownSlide | null,
  deck: DeckLike | undefined
): ShownSlide | null {
  if (!shown || !deck || deck.id !== shown.deckId) return null
  if (deck.slides[shown.index]?.file === shown.file) return shown
  const index = deck.slides.findIndex((s) => s.file === shown.file)
  return index < 0 ? null : { ...shown, index }
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

export function reduce(state: ProgramState, action: Action, decks: DeckLike[]): ProgramState {
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
      return step(state, decks, action.type === 'next' ? 1 : -1)
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
    case 'toggleFreeze': {
      if (!state.frozen) return { ...state, frozen: true }
      // Unfreeze: the operator position (the preview while frozen) goes live at
      // once. Nothing on the output (STANDBY) or an invalid position: only the
      // freeze is cleared. Black stays as it is, the new slide is behind it.
      const deck = decks.find((d) => d.id === state.deckId)
      const valid =
        !!deck &&
        Number.isInteger(state.index) &&
        state.index >= 0 &&
        state.index < deck.slides.length
      if (!state.shown || !deck || !valid) return { ...state, frozen: false }
      return moveTo({ ...state, frozen: false }, deck, state.index)
    }
    case 'toggleBlack':
      return { ...state, black: !state.black }
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

  if (deckId === state.deckId && index === state.index && shown === state.shown) return state
  return { ...state, deckId, index, shown }
}
