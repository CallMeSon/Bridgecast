import type { DeckMeta } from './types'

export interface ShownSlide {
  deckId: string
  index: number
}

export interface ProgramState {
  deckId: string | null
  index: number
  shown: ShownSlide | null
  frozen: boolean
  black: boolean
  transition: 'cut' | 'fade'
}

export type Action =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }
  | { type: 'selectDeck'; deckId: string }
  | { type: 'toggleFreeze' }
  | { type: 'toggleBlack' }
  | { type: 'setTransition'; transition: 'cut' | 'fade' }

type DeckLike = Pick<DeckMeta, 'id' | 'slides'>

export const initialState: ProgramState = {
  deckId: null,
  index: 0,
  shown: null,
  frozen: false,
  black: false,
  transition: 'cut'
}

/** Move the operator position; `shown` follows unless frozen. */
function moveTo(state: ProgramState, deckId: string, index: number): ProgramState {
  return {
    ...state,
    deckId,
    index,
    shown: state.frozen ? state.shown : { deckId, index }
  }
}

function step(state: ProgramState, decks: DeckLike[], dir: 1 | -1): ProgramState {
  const flat: ShownSlide[] = []
  for (const d of decks) {
    for (let i = 0; i < d.slides.length; i++) flat.push({ deckId: d.id, index: i })
  }
  const pos = flat.findIndex((p) => p.deckId === state.deckId && p.index === state.index)
  if (pos < 0) return state
  const target = flat[pos + dir]
  if (!target) return state
  return moveTo(state, target.deckId, target.index)
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
      if (pendingTake(state, decks)) return moveTo(state, state.deckId!, state.index)
      return step(state, decks, action.type === 'next' ? 1 : -1)
    case 'goto': {
      const deck = decks.find((d) => d.id === state.deckId)
      if (!deck || !Number.isInteger(action.index)) return state
      if (action.index < 0 || action.index >= deck.slides.length) return state
      return moveTo(state, deck.id, action.index)
    }
    case 'selectDeck': {
      const deck = decks.find((d) => d.id === action.deckId)
      if (!deck || deck.slides.length === 0) return state
      return moveTo(state, deck.id, 0)
    }
    case 'toggleFreeze':
      return { ...state, frozen: !state.frozen }
    case 'toggleBlack':
      return { ...state, black: !state.black }
    case 'setTransition':
      return { ...state, transition: action.transition }
  }
}

export function reconcile(state: ProgramState, decks: DeckLike[]): ProgramState {
  let shown = state.shown
  if (shown) {
    const d = decks.find((x) => x.id === shown!.deckId)
    if (!d || shown.index < 0 || shown.index >= d.slides.length) shown = null
  }

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
