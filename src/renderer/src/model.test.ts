import { describe, it, expect } from 'vitest'
import type { DeckMeta } from '../../shared/types'
import { initialState, type ProgramState } from '../../shared/program'
import {
  baseName,
  canPrev,
  errorMessage,
  fileKind,
  keyToAction,
  nextIndex,
  nextView,
  outputSource,
  tally
} from './model'

const deck = (id: string, n: number, name = id): DeckMeta => ({
  id,
  name,
  source: 'pdf',
  width: 1920,
  height: 1080,
  slides: Array.from({ length: n }, (_, i) => ({ file: `${i}.png`, notes: `n${i}` }))
})

const at = (
  deckId: string | null,
  index: number,
  extra: Partial<ProgramState> = {}
): ProgramState => ({
  ...initialState,
  deckId,
  index,
  shown: deckId ? { deckId, index } : null,
  ...extra
})

describe('nextView', () => {
  const decks = [deck('a', 2, 'A'), deck('e', 0, 'Empty'), deck('b', 1, 'B')]
  it('shows the following slide with its notes', () => {
    expect(nextView(decks, at('a', 0))).toEqual({
      kind: 'slide',
      deckId: 'a',
      index: 1,
      notes: 'n1'
    })
  })
  it('shows end of deck with the next ready deck name', () => {
    expect(nextView(decks, at('a', 1))).toEqual({ kind: 'end', nextDeck: 'B' })
    expect(nextView(decks, at('b', 0))).toEqual({ kind: 'end', nextDeck: null })
  })
  it('shows the current slide while nothing of this event is shown (Next takes it)', () => {
    expect(nextView(decks, at('a', 0, { shown: null }))).toEqual({
      kind: 'slide',
      deckId: 'a',
      index: 0,
      notes: 'n0'
    })
    const leftover = at('b', 0, { shown: { deckId: 'other', index: 3 } })
    expect(nextView(decks, leftover)).toMatchObject({ kind: 'slide', deckId: 'b', index: 0 })
    expect(nextIndex(decks, leftover)).toBe(0)
  })
  it('frozen STANDBY still previews the following slide', () => {
    expect(nextView(decks, at('a', 0, { shown: null, frozen: true }))).toMatchObject({ index: 1 })
  })
  it('is none without a position', () => {
    expect(nextView([], at(null, 0))).toEqual({ kind: 'none' })
  })
})

describe('canPrev', () => {
  const decks = [deck('a', 2), deck('b', 2)]
  it('is false on the first slide of the first deck, true otherwise', () => {
    expect(canPrev(decks, at('a', 0))).toBe(false)
    expect(canPrev(decks, at('a', 1))).toBe(true)
    expect(canPrev(decks, at('b', 0))).toBe(true)
    expect(canPrev([], at(null, 0))).toBe(false)
    // Prev takes the position live while STANDBY, so it is enabled.
    expect(canPrev(decks, at('a', 0, { shown: null }))).toBe(true)
  })
})

describe('tally', () => {
  const shown = { deckId: 'a', index: 0 }
  it('maps state to badge', () => {
    expect(tally(at('a', 0, { shown: null }))).toBe('idle')
    expect(tally(at('a', 0, { shown }))).toBe('live')
    expect(tally(at('a', 0, { shown, frozen: true }))).toBe('frozen')
    expect(tally(at('a', 0, { shown, frozen: true, black: true }))).toBe('black')
  })
})

describe('keyToAction', () => {
  const body = { tagName: 'BODY' } as unknown as EventTarget
  it('maps shortcuts', () => {
    expect(keyToAction({ key: ' ', target: body })).toEqual({ type: 'next' })
    expect(keyToAction({ key: 'ArrowRight', target: body })).toEqual({ type: 'next' })
    expect(keyToAction({ key: 'ArrowLeft', target: body })).toEqual({ type: 'prev' })
    expect(keyToAction({ key: 'F', target: body })).toEqual({ type: 'toggleFreeze' })
    expect(keyToAction({ key: 'b', target: body })).toEqual({ type: 'toggleBlack' })
    expect(keyToAction({ key: 'x', target: body })).toBeNull()
  })
  it('ignores typing targets, modifiers and repeated toggles', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(keyToAction({ key: ' ', target: { tagName } as unknown as EventTarget })).toBeNull()
    }
    expect(keyToAction({ key: 'f', ctrlKey: true, target: body })).toBeNull()
    expect(keyToAction({ key: 'f', repeat: true, target: body })).toBeNull()
  })
})

describe('files', () => {
  it('classifies by extension', () => {
    expect(fileKind('a.PPTX')).toBe('pptx')
    expect(fileKind('a.ppt')).toBe('pptx')
    expect(fileKind('a.pdf')).toBe('pdf')
    expect(fileKind('a.txt')).toBe('unsupported')
    expect(baseName('Keynote v2.pdf')).toBe('Keynote v2')
  })
})

describe('errorMessage', () => {
  it('strips the Electron IPC prefix', () => {
    const e = new Error("Error invoking remote method 'events:create': Error: Nama event kosong")
    expect(errorMessage(e)).toBe('Nama event kosong')
    expect(errorMessage(new Error('Biasa'))).toBe('Biasa')
  })
})

describe('outputSource', () => {
  const shown = { deckId: '11111111-1111-1111-1111-111111111111', index: 2 }
  it('shows the shown slide, not the operator position', () => {
    const s: ProgramState = { ...initialState, deckId: 'other', index: 5, shown }
    expect(outputSource(s)).toBe(`slide://${shown.deckId}/2.png`)
  })
  it('is black when nothing is shown', () => {
    expect(outputSource({ ...initialState, deckId: 'd', index: 1 })).toBeNull()
  })
  it('is black when Black is on', () => {
    expect(outputSource({ ...initialState, shown, black: true })).toBeNull()
  })
  it('keeps the shown slide while frozen', () => {
    const s: ProgramState = { ...initialState, deckId: shown.deckId, index: 3, shown, frozen: true }
    expect(outputSource(s)).toBe(`slide://${shown.deckId}/2.png`)
  })
})
