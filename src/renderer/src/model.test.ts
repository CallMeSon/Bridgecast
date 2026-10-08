import { describe, it, expect } from 'vitest'
import type { DeckMeta } from '../../shared/types'
import { initialState, reduce, type ProgramState } from '../../shared/program'
import {
  baseName,
  canNext,
  canPrev,
  errorMessage,
  fileKind,
  hasFiles,
  importMeta,
  keyToAction,
  menuFocusTarget,
  reorderTarget,
  slideLabel,
  slideRole,
  moveItem,
  moveOrder,
  nextIndex,
  hdmiBadge,
  hdmiStatusText,
  nextView,
  outputSource,
  TALLY_TEXT,
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
  shown: deckId ? { deckId, index, file: `${index}.png` } : null,
  ...extra
})

describe('nextView', () => {
  const decks = [deck('a', 2, 'A'), deck('e', 0, 'Empty'), deck('b', 1, 'B')]
  it('shows the following slide with its notes', () => {
    expect(nextView(decks, at('a', 0))).toEqual({
      kind: 'slide',
      deckId: 'a',
      index: 1,
      file: '1.png',
      notes: 'n1'
    })
  })
  it('shows end of deck with the next ready deck name and whether Next goes there', () => {
    expect(nextView(decks, at('a', 1, { autoAdvance: true }))).toEqual({
      kind: 'end',
      nextDeck: 'B',
      auto: true
    })
    expect(nextView(decks, at('a', 1))).toEqual({ kind: 'end', nextDeck: 'B', auto: false })
    expect(nextView(decks, at('b', 0))).toEqual({ kind: 'end', nextDeck: null, auto: false })
  })
  it('shows the current slide while nothing of this event is shown (Next takes it)', () => {
    expect(nextView(decks, at('a', 0, { shown: null }))).toEqual({
      kind: 'slide',
      deckId: 'a',
      index: 0,
      file: '0.png',
      notes: 'n0'
    })
    const leftover = at('b', 0, { shown: { deckId: 'other', index: 3, file: '004.png' } })
    expect(nextView(decks, leftover)).toMatchObject({ kind: 'slide', deckId: 'b', index: 0 })
    expect(nextIndex(decks, leftover)).toBe(0)
  })
  it('frozen shows the operator position as a held preview', () => {
    expect(
      nextView(decks, at('a', 1, { shown: { deckId: 'a', index: 0, file: '0.png' }, frozen: true }))
    ).toEqual({
      kind: 'slide',
      deckId: 'a',
      index: 1,
      file: '1.png',
      notes: 'n1',
      held: true
    })
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
    expect(canPrev(decks, at('b', 0, { autoAdvance: true }))).toBe(true)
    // Auto advance off: Prev never leaves the live deck.
    expect(canPrev(decks, at('b', 0))).toBe(false)
    expect(canPrev([], at(null, 0))).toBe(false)
    // Prev takes the position live while STANDBY, so it is enabled.
    expect(canPrev(decks, at('a', 0, { shown: null }))).toBe(true)
  })
})

describe('canNext', () => {
  const decks = [deck('a', 2, 'A'), deck('b', 1, 'B')]
  it('is false at the end of the live deck unless auto advance goes on', () => {
    expect(canNext(decks, at('a', 0))).toBe(true)
    expect(canNext(decks, at('a', 1))).toBe(false)
    expect(canNext(decks, at('a', 1, { autoAdvance: true }))).toBe(true)
    expect(canNext(decks, at('b', 0, { autoAdvance: true }))).toBe(false)
    expect(canNext([], at(null, 0))).toBe(false)
    // STANDBY on the last slide: Next takes it live.
    expect(canNext(decks, at('a', 1, { shown: null }))).toBe(true)
    // Frozen follows the position: stepping stays possible until the end.
    expect(canNext(decks, at('a', 0, { frozen: true }))).toBe(true)
    expect(canNext(decks, at('a', 1, { frozen: true }))).toBe(false)
    expect(canNext(decks, at('a', 1, { frozen: true, autoAdvance: true }))).toBe(true)
  })
})

describe('tally', () => {
  const shown = { deckId: 'a', index: 0, file: '001.png' }
  it('maps state to badge', () => {
    expect(tally(at('a', 0, { shown: null }))).toBe('idle')
    expect(tally(at('a', 0, { shown }))).toBe('live')
    expect(tally(at('a', 0, { shown, frozen: true }))).toBe('frozen')
    expect(tally(at('a', 0, { shown, frozen: true, black: true }))).toBe('black')
  })
  it('is kv while KV is on (with or without a slide, even frozen), standby for an automatic KV', () => {
    const kvUrl = 'slide://kv/e/k.png'
    expect(tally(at('a', 0, { shown, kv: true, kvUrl }))).toBe('kv')
    expect(tally(at('a', 0, { shown, frozen: true, kv: true, kvUrl }))).toBe('kv')
    expect(tally(at('a', 0, { shown: null, kv: true, kvUrl }))).toBe('kv')
    expect(tally(at('a', 0, { shown: null, kvUrl }))).toBe('idle')
    expect(tally(at('a', 0, { shown, kvUrl }))).toBe('live')
    expect(TALLY_TEXT.kv).toBe('KV')
  })
  it('is black at STANDBY after K turned the automatic KV off', () => {
    const kvUrl = 'slide://kv/e/k.png'
    expect(tally(at('a', 0, { shown: null, kvUrl, black: true }))).toBe('black')
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
    expect(keyToAction({ key: 'k', target: body })).toEqual({ type: 'toggleKv' })
    expect(keyToAction({ key: 'K', target: body })).toEqual({ type: 'toggleKv' })
    expect(keyToAction({ key: 'k', repeat: true, target: body })).toBeNull()
    expect(keyToAction({ key: 'k', ctrlKey: true, target: body })).toBeNull()
    expect(keyToAction({ key: 'x', target: body })).toBeNull()
  })
  it('maps presentation clicker keys', () => {
    expect(keyToAction({ key: 'PageDown', target: body })).toEqual({ type: 'next' })
    expect(keyToAction({ key: 'PageUp', target: body })).toEqual({ type: 'prev' })
    expect(keyToAction({ key: '.', target: body })).toEqual({ type: 'toggleBlack' })
  })
  it('ignores typing targets, modifiers and repeated toggles', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(keyToAction({ key: ' ', target: { tagName } as unknown as EventTarget })).toBeNull()
    }
    expect(keyToAction({ key: 'f', ctrlKey: true, target: body })).toBeNull()
    expect(keyToAction({ key: 'f', repeat: true, target: body })).toBeNull()
  })
  it('ignores held next/prev keys (repeat) so a held key or clicker never skips slides', () => {
    for (const key of [' ', 'ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp']) {
      expect(keyToAction({ key, repeat: true, target: body })).toBeNull()
      expect(keyToAction({ key, repeat: false, target: body })).not.toBeNull()
    }
  })
  it('leaves Alt+arrows alone (keyboard reorder, never Prev/Next)', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
      expect(keyToAction({ key, altKey: true, target: body })).toBeNull()
    }
  })
  it('ignores every key while focus is inside the output popover (buttons too)', () => {
    const inPopover = {
      tagName: 'BUTTON',
      closest: (sel: string) => (sel === '[data-no-shortcuts]' ? {} : null)
    } as unknown as EventTarget
    const plainButton = { tagName: 'BUTTON', closest: () => null } as unknown as EventTarget
    for (const key of [' ', 'ArrowRight', 'ArrowLeft', 'f', 'b']) {
      expect(keyToAction({ key, target: inPopover })).toBeNull()
    }
    expect(keyToAction({ key: 'b', target: plainButton })).toEqual({ type: 'toggleBlack' })
  })
})

describe('slide roles and labels', () => {
  const decks = [deck('a', 5, 'A')]
  it('names the role in the label', () => {
    expect(slideLabel(2, 'live')).toBe('Slide 3, tayang')
    expect(slideLabel(3, 'next')).toBe('Slide 4, berikutnya')
    expect(slideLabel(1, 'frozen')).toBe('Slide 2, tertahan (Freeze)')
    expect(slideLabel(0, undefined)).toBe('Slide 1')
  })
  it('marks the slide on air LIVE, and FROZEN while Freeze holds it', () => {
    const live = at('a', 1)
    expect(slideRole(decks, live, 'a', 1)).toBe('live')
    expect(slideRole(decks, live, 'a', 2)).toBe('next')
    const frozen = {
      ...at('a', 3),
      frozen: true,
      shown: { deckId: 'a', index: 1, file: '1.png' }
    }
    expect(slideRole(decks, frozen, 'a', 1)).toBe('frozen')
    expect(slideRole(decks, frozen, 'a', 3)).toBe('pos')
  })
  it('does not mark a blacked out slide as on air', () => {
    expect(slideRole(decks, at('a', 1, { black: true }), 'a', 1)).toBe('pos')
  })
})

describe('keyboard reorder and menu focus', () => {
  it('moves one step within bounds on the matching axis', () => {
    expect(reorderTarget('ArrowDown', 'vertical', 1, 3)).toBe(2)
    expect(reorderTarget('ArrowUp', 'vertical', 1, 3)).toBe(0)
    expect(reorderTarget('ArrowUp', 'vertical', 0, 3)).toBeNull()
    expect(reorderTarget('ArrowDown', 'vertical', 2, 3)).toBeNull()
    expect(reorderTarget('ArrowRight', 'horizontal', 0, 3)).toBe(1)
    expect(reorderTarget('ArrowLeft', 'horizontal', 2, 3)).toBe(1)
    expect(reorderTarget('ArrowRight', 'vertical', 0, 3)).toBeNull()
  })
  it('roves menu focus with wrap, Home and End', () => {
    expect(menuFocusTarget('ArrowDown', 0, 3)).toBe(1)
    expect(menuFocusTarget('ArrowDown', 2, 3)).toBe(0)
    expect(menuFocusTarget('ArrowUp', 0, 3)).toBe(2)
    expect(menuFocusTarget('Home', 2, 3)).toBe(0)
    expect(menuFocusTarget('End', 0, 3)).toBe(2)
    expect(menuFocusTarget('x', 0, 3)).toBeNull()
    expect(menuFocusTarget('ArrowDown', 0, 0)).toBeNull()
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
  // The slide at index 2 is file 005.png (its deck was reordered).
  const shown = { deckId: '11111111-1111-1111-1111-111111111111', index: 2, file: '005.png' }
  it('shows the shown slide by its file, not the operator position or index', () => {
    const s: ProgramState = { ...initialState, deckId: 'other', index: 5, shown }
    expect(outputSource(s)).toBe(`slide://${shown.deckId}/005.png`)
  })
  it('is black when nothing is shown', () => {
    expect(outputSource({ ...initialState, deckId: 'd', index: 1 })).toBeNull()
  })
  it('is black when Black is on', () => {
    expect(outputSource({ ...initialState, shown, black: true })).toBeNull()
  })
  it('keeps the shown slide while frozen', () => {
    const s: ProgramState = { ...initialState, deckId: shown.deckId, index: 3, shown, frozen: true }
    expect(outputSource(s)).toBe(`slide://${shown.deckId}/005.png`)
  })
})

describe('outputSource with KV', () => {
  const shown = { deckId: '11111111-1111-1111-1111-111111111111', index: 0, file: '001.png' }
  const kvUrl =
    'slide://kv/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.png'
  const slide = `slide://${shown.deckId}/001.png`
  const base: ProgramState = { ...initialState, kvUrl }
  it('STANDBY shows the KV automatically, or black without one', () => {
    expect(outputSource(base)).toBe(kvUrl)
    expect(outputSource({ ...initialState })).toBeNull()
  })
  it('a shown slide wins over the automatic KV', () => {
    expect(outputSource({ ...base, shown })).toBe(slide)
    expect(outputSource({ ...base, shown, frozen: true })).toBe(slide)
  })
  it('KV on shows the KV over a slide, also when frozen', () => {
    expect(outputSource({ ...base, shown, kv: true })).toBe(kvUrl)
    expect(outputSource({ ...base, shown, kv: true, frozen: true })).toBe(kvUrl)
    expect(outputSource({ ...base, kv: true })).toBe(kvUrl)
  })
  it('KV on without a kvUrl falls back to the slide', () => {
    expect(outputSource({ ...initialState, shown, kv: true })).toBe(slide)
  })
  it('K at STANDBY (black) leaves the KV; K again shows it; LIVE K, K returns to the slide', () => {
    const standby: ProgramState = { ...base }
    const off = reduce(standby, { type: 'toggleKv' }, [])
    expect(outputSource(off)).toBeNull()
    const on = reduce(off, { type: 'toggleKv' }, [])
    expect(outputSource(on)).toBe(kvUrl)
    const live: ProgramState = { ...base, shown }
    const forced = reduce(live, { type: 'toggleKv' }, [])
    expect(outputSource(forced)).toBe(kvUrl)
    expect(outputSource(reduce(forced, { type: 'toggleKv' }, []))).toBe(slide)
  })
  it('Black wins over everything', () => {
    expect(outputSource({ ...base, shown, black: true })).toBeNull()
    expect(outputSource({ ...base, black: true })).toBeNull()
    expect(outputSource({ ...base, shown, black: true, kv: true })).toBeNull()
  })
})

describe('drag and drop helpers', () => {
  it('hasFiles only for drags from outside carrying files', () => {
    expect(hasFiles(['Files'])).toBe(true)
    expect(hasFiles(['text/uri-list', 'Files'])).toBe(true)
    expect(hasFiles(['application/x-ppt-share-slide'])).toBe(false)
    expect(hasFiles([])).toBe(false)
    expect(hasFiles(null)).toBe(false)
  })
  it('moveItem takes the item out and inserts it at the target index', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    const src = ['a', 'b']
    moveItem(src, 0, 1)
    expect(src).toEqual(['a', 'b'])
  })
  it('moveOrder gives order[newIndex] = oldIndex for slides:reorder', () => {
    expect(moveOrder(3, 1, 0)).toEqual([1, 0, 2])
    expect(moveOrder(3, 0, 2)).toEqual([1, 2, 0])
    expect(moveOrder(3, 2, 2)).toEqual([0, 1, 2])
  })
  it('fileKind is case-insensitive', () => {
    expect(fileKind('A.PPTX')).toBe('pptx')
    expect(fileKind('b.Ppt')).toBe('pptx')
    expect(fileKind('c.PDF')).toBe('pdf')
    expect(fileKind('notes.txt')).toBe('unsupported')
    expect(fileKind('pptx')).toBe('unsupported')
  })
  it('importMeta: queued at 0 %, converting after', () => {
    expect(importMeta(0)).toBe('Menunggu')
    expect(importMeta(10)).toBe('Mengonversi')
  })
})

describe('hdmiBadge', () => {
  const on = { enabled: true, displayId: 2 }
  it('green only while the window is actually showing', () => {
    expect(hdmiBadge({ state: 'showing' }, on)).toEqual({ tone: 'ok', text: 'HDMI tampil' })
  })
  it('gray when off or still preparing, amber when the display is unplugged, red on error', () => {
    expect(hdmiBadge({ state: 'off' }, { enabled: false, displayId: 2 })).toEqual({
      tone: 'off',
      text: 'HDMI mati'
    })
    expect(hdmiBadge(null, on)).toEqual({ tone: 'off', text: 'HDMI memulai…' })
    expect(hdmiBadge({ state: 'hidden', message: 'Menyiapkan output HDMI…' }, on)).toEqual({
      tone: 'off',
      text: 'HDMI memulai…'
    })
    expect(hdmiBadge({ state: 'hidden' }, on)).toEqual({ tone: 'warn', text: 'HDMI tersembunyi' })
    expect(hdmiBadge({ state: 'error', message: 'x' }, on)).toEqual({
      tone: 'error',
      text: 'HDMI bermasalah'
    })
  })
  it('settings say off: gray even before the status arrives', () => {
    expect(hdmiBadge(null, { enabled: false, displayId: null }).tone).toBe('off')
  })
})

describe('hdmiStatusText', () => {
  const on = { enabled: true, displayId: 2 }
  it('uses the agreed copy', () => {
    expect(hdmiStatusText({ state: 'showing' }, on)).toBe('Tampil')
    expect(hdmiStatusText({ state: 'hidden' }, on)).toBe('Tersembunyi, layar tidak tersambung')
    expect(hdmiStatusText({ state: 'off' }, { enabled: false, displayId: null })).toBe('Mati')
    expect(hdmiStatusText({ state: 'error', message: 'Pilih layar lain.' }, on)).toBe(
      'Pilih layar lain.'
    )
    expect(hdmiStatusText({ state: 'hidden', message: 'Menyiapkan output HDMI…' }, on)).toBe(
      'Menyiapkan output HDMI…'
    )
  })
})
