import { describe, it, expect } from 'vitest'
import type { DeckMeta } from '../../shared/types'
import { initialState, type ProgramState } from '../../shared/program'
import {
  baseName,
  canPrev,
  errorMessage,
  fileKind,
  hasFiles,
  importMeta,
  keyToAction,
  moveItem,
  moveOrder,
  nextIndex,
  hdmiBadge,
  hdmiStatusText,
  ndiBadge,
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
  it('shows end of deck with the next ready deck name', () => {
    expect(nextView(decks, at('a', 1))).toEqual({ kind: 'end', nextDeck: 'B' })
    expect(nextView(decks, at('b', 0))).toEqual({ kind: 'end', nextDeck: null })
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
  const shown = { deckId: 'a', index: 0, file: '001.png' }
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
  it('ignores every key while focus is inside the NDI popover (buttons too)', () => {
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

describe('ndiBadge', () => {
  const ndi = { enabled: true, name: 'PPT Share', width: 1920, height: 1080, fps: 30 }
  it('green only while the sender is running, with name and format', () => {
    expect(ndiBadge({ state: 'running', source: 'PC (PPT Share)' }, ndi)).toEqual({
      tone: 'ok',
      name: 'PPT Share',
      detail: '1920×1080 · 30 fps'
    })
    expect(
      ndiBadge({ state: 'running' }, { ...ndi, width: 3840, height: 2160, fps: 60 }).detail
    ).toBe('3840×2160 · 60 fps')
  })
  it('gray when off or still starting', () => {
    expect(ndiBadge({ state: 'stopped' }, { ...ndi, enabled: false })).toEqual({
      tone: 'off',
      name: null,
      detail: 'nonaktif'
    })
    expect(ndiBadge({ state: 'stopped' }, ndi)).toEqual({
      tone: 'off',
      name: 'PPT Share',
      detail: 'memulai…'
    })
    expect(ndiBadge(null, ndi).tone).toBe('off')
  })
  it('red with a short label on error', () => {
    expect(ndiBadge({ state: 'error', message: 'x' }, ndi)).toEqual({
      tone: 'error',
      name: 'PPT Share',
      detail: 'bermasalah'
    })
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
    expect(hdmiStatusText({ state: 'hidden' }, on)).toBe('Tersembunyi — layar tidak tersambung')
    expect(hdmiStatusText({ state: 'off' }, { enabled: false, displayId: null })).toBe('Mati')
    expect(hdmiStatusText({ state: 'error', message: 'Pilih layar lain.' }, on)).toBe(
      'Pilih layar lain.'
    )
    expect(hdmiStatusText({ state: 'hidden', message: 'Menyiapkan output HDMI…' }, on)).toBe(
      'Menyiapkan output HDMI…'
    )
  })
})
