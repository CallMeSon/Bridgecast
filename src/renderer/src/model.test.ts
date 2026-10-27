import { describe, it, expect } from 'vitest'
import type { DeckMeta, SectionMeta } from '../../shared/types'
import { initialState, reduce, type ProgramState } from '../../shared/program'
import type { DeckFit } from '../../shared/canvas'
import type { AudioSettings } from '../../shared/settings'
import {
  baseName,
  canNext,
  canPrev,
  canNextSection,
  canPrevSection,
  errorMessage,
  fileKind,
  hasFiles,
  countOf,
  deckSoundLabel,
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
  outputGain,
  outputSource,
  type OutputMedia,
  TALLY_TEXT,
  tally,
  needsCanvasConfirm
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
  it('marks a next slide that is a video', () => {
    const vd = deck('v', 3)
    vd.slides[1].video = '1.mp4'
    expect(nextView([vd], at('v', 0))).toMatchObject({ kind: 'slide', index: 1, video: true })
    expect(nextView([vd], at('v', 1))).not.toHaveProperty('video')
    const held = at('v', 1, { shown: { deckId: 'v', index: 0, file: '0.png' }, frozen: true })
    expect(nextView([vd], held)).toMatchObject({ held: true, video: true })
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

describe('needsCanvasConfirm', () => {
  const shown = { deckId: 'a', index: 0, file: '001.png' }
  const kvUrl = 'slide://kv/e/k.png'
  it('is false at STANDBY and BLACK: the audience sees no slide change', () => {
    expect(needsCanvasConfirm(at('a', 0, { shown: null }))).toBe(false)
    expect(needsCanvasConfirm(at('a', 0, { shown, black: true }))).toBe(false)
    expect(needsCanvasConfirm(at('a', 0, { shown: null, kvUrl, black: true }))).toBe(false)
  })
  it('is true while live, frozen or showing KV', () => {
    expect(needsCanvasConfirm(at('a', 0, { shown }))).toBe(true)
    expect(needsCanvasConfirm(at('a', 0, { shown, frozen: true }))).toBe(true)
    expect(needsCanvasConfirm(at('a', 0, { shown, kv: true, kvUrl }))).toBe(true)
    expect(needsCanvasConfirm(at('a', 0, { shown: null, kv: true, kvUrl }))).toBe(true)
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
    expect(slideLabel(2, 'live')).toBe('Slide 3, live')
    expect(slideLabel(3, 'next')).toBe('Slide 4, next')
    expect(slideLabel(1, 'frozen')).toBe('Slide 2, frozen')
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
    const e = new Error("Error invoking remote method 'events:create': Error: Event name is empty")
    expect(errorMessage(e)).toBe('Event name is empty')
    expect(errorMessage(new Error('Biasa'))).toBe('Biasa')
  })
})

const img = (url: string, fit: DeckFit = 'fit'): OutputMedia => ({ kind: 'image', url, fit })

describe('outputSource with a video slide', () => {
  const deckId = '44444444-4444-4444-4444-444444444444'
  const shown = { deckId, index: 0, file: '001.png', video: '001.mp4' }
  const kvUrl = 'slide://kv/22222222-2222-2222-2222-222222222222/k.png'
  it('a shown video slide is a video with its PNG as poster and the take', () => {
    expect(outputSource({ ...initialState, shown, take: 7 })).toEqual({
      kind: 'video',
      url: `slide://${deckId}/001.mp4`,
      poster: `slide://${deckId}/001.png`,
      take: 7,
      fit: 'fit'
    })
  })
  it('the deck fit of the shown slide rides on the media; a shown without fit is fit', () => {
    expect(
      outputSource({ ...initialState, shown: { ...shown, fit: 'fill' }, take: 7 })
    ).toMatchObject({
      kind: 'video',
      fit: 'fill'
    })
    const still = { deckId, index: 0, file: '001.png' }
    expect(outputSource({ ...initialState, shown: { ...still, fit: 'stretch' } })).toEqual(
      img(`slide://${deckId}/001.png`, 'stretch')
    )
  })
  it('KV and STANDBY KV are always fit, whatever the shown slide had', () => {
    expect(
      outputSource({ ...initialState, shown: { ...shown, fit: 'fill' }, kvUrl, kv: true })
    ).toEqual(img(kvUrl, 'fit'))
    expect(outputSource({ ...initialState, kvUrl })).toEqual(img(kvUrl, 'fit'))
  })
  it('a shown image slide is an image', () => {
    const still = { deckId, index: 0, file: '001.png' }
    expect(outputSource({ ...initialState, shown: still, take: 3 })).toEqual(
      img(`slide://${deckId}/001.png`)
    )
  })
  it('KV over a video slide is the KV image', () => {
    expect(outputSource({ ...initialState, shown, kvUrl, kv: true, take: 2 })).toEqual(img(kvUrl))
  })
  it('Black over a video slide is black', () => {
    expect(outputSource({ ...initialState, shown, black: true, take: 2 })).toBeNull()
  })
})

describe('outputSource', () => {
  // The slide at index 2 is file 005.png (its deck was reordered).
  const shown = { deckId: '11111111-1111-1111-1111-111111111111', index: 2, file: '005.png' }
  it('shows the shown slide by its file, not the operator position or index', () => {
    const s: ProgramState = { ...initialState, deckId: 'other', index: 5, shown }
    expect(outputSource(s)).toEqual(img(`slide://${shown.deckId}/005.png`))
  })
  it('is black when nothing is shown', () => {
    expect(outputSource({ ...initialState, deckId: 'd', index: 1 })).toBeNull()
  })
  it('is black when Black is on', () => {
    expect(outputSource({ ...initialState, shown, black: true })).toBeNull()
  })
  it('keeps the shown slide while frozen', () => {
    const s: ProgramState = { ...initialState, deckId: shown.deckId, index: 3, shown, frozen: true }
    expect(outputSource(s)).toEqual(img(`slide://${shown.deckId}/005.png`))
  })
})

describe('outputSource with KV', () => {
  const shown = { deckId: '11111111-1111-1111-1111-111111111111', index: 0, file: '001.png' }
  const kvUrl =
    'slide://kv/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.png'
  const slide = `slide://${shown.deckId}/001.png`
  const base: ProgramState = { ...initialState, kvUrl }
  it('STANDBY shows the KV automatically, or black without one', () => {
    expect(outputSource(base)).toEqual(img(kvUrl))
    expect(outputSource({ ...initialState })).toBeNull()
  })
  it('a shown slide wins over the automatic KV', () => {
    expect(outputSource({ ...base, shown })).toEqual(img(slide))
    expect(outputSource({ ...base, shown, frozen: true })).toEqual(img(slide))
  })
  it('KV on shows the KV over a slide, also when frozen', () => {
    expect(outputSource({ ...base, shown, kv: true })).toEqual(img(kvUrl))
    expect(outputSource({ ...base, shown, kv: true, frozen: true })).toEqual(img(kvUrl))
    expect(outputSource({ ...base, kv: true })).toEqual(img(kvUrl))
  })
  it('KV on without a kvUrl falls back to the slide', () => {
    expect(outputSource({ ...initialState, shown, kv: true })).toEqual(img(slide))
  })
  it('K at STANDBY (black) leaves the KV; K again shows it; LIVE K, K returns to the slide', () => {
    const standby: ProgramState = { ...base }
    const off = reduce(standby, { type: 'toggleKv' }, [])
    expect(outputSource(off)).toBeNull()
    const on = reduce(off, { type: 'toggleKv' }, [])
    expect(outputSource(on)).toEqual(img(kvUrl))
    const live: ProgramState = { ...base, shown }
    const forced = reduce(live, { type: 'toggleKv' }, [])
    expect(outputSource(forced)).toEqual(img(kvUrl))
    expect(outputSource(reduce(forced, { type: 'toggleKv' }, []))).toEqual(img(slide))
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
  it('countOf pluralises the noun', () => {
    expect(countOf(0, 'deck')).toBe('0 decks')
    expect(countOf(1, 'slide')).toBe('1 slide')
    expect(countOf(3, 'slide')).toBe('3 slides')
  })

  it('importMeta: queued at 0 %, converting after', () => {
    expect(importMeta(0)).toBe('Queued')
    expect(importMeta(10)).toBe('Converting')
  })
})

describe('hdmiBadge', () => {
  const on = { enabled: true, displayId: 2 }
  it('green only while the window is actually showing', () => {
    expect(hdmiBadge({ state: 'showing' }, on)).toEqual({ tone: 'ok', text: 'HDMI live' })
  })
  it('gray when off or still preparing, amber when the display is unplugged, red on error', () => {
    expect(hdmiBadge({ state: 'off' }, { enabled: false, displayId: 2 })).toEqual({
      tone: 'off',
      text: 'HDMI off'
    })
    expect(hdmiBadge(null, on)).toEqual({ tone: 'off', text: 'HDMI starting…' })
    expect(hdmiBadge({ state: 'hidden', message: 'Menyiapkan output HDMI…' }, on)).toEqual({
      tone: 'off',
      text: 'HDMI starting…'
    })
    expect(hdmiBadge({ state: 'hidden' }, on)).toEqual({ tone: 'warn', text: 'HDMI hidden' })
    expect(hdmiBadge({ state: 'error', message: 'x' }, on)).toEqual({
      tone: 'error',
      text: 'HDMI error'
    })
  })
  it('settings say off: gray even before the status arrives', () => {
    expect(hdmiBadge(null, { enabled: false, displayId: null }).tone).toBe('off')
  })
})

describe('hdmiStatusText', () => {
  const on = { enabled: true, displayId: 2 }
  it('uses the agreed copy', () => {
    expect(hdmiStatusText({ state: 'showing' }, on)).toBe('Live')
    expect(hdmiStatusText({ state: 'hidden' }, on)).toBe('Hidden, display not connected')
    expect(hdmiStatusText({ state: 'off' }, { enabled: false, displayId: null })).toBe('Off')
    expect(hdmiStatusText({ state: 'error', message: 'Choose another display.' }, on)).toBe(
      'Choose another display.'
    )
    expect(hdmiStatusText({ state: 'hidden', message: 'Menyiapkan output HDMI…' }, on)).toBe(
      'Menyiapkan output HDMI…'
    )
  })
})

describe('sections', () => {
  const decks = [deck('a', 2, 'A'), deck('b', 1, 'B'), deck('c', 1, 'C')]
  const secs: SectionMeta[] = [
    { id: 's1', name: 'Part 1', at: 0 },
    { id: 's2', name: 'Part 2', at: 1 },
    { id: 's3', name: 'Part 3', at: 2 }
  ]
  const auto = { autoAdvance: true }
  it('sectionEnd names the next section', () => {
    expect(nextView(decks, at('a', 1, auto), secs)).toEqual({
      kind: 'sectionEnd',
      nextSection: 'Part 2'
    })
  })
  it('sectionEnd is null on the last segment', () => {
    expect(nextView(decks, at('c', 0, auto), secs)).toEqual({
      kind: 'sectionEnd',
      nextSection: null
    })
  })
  it('auto off keeps end', () => {
    expect(nextView(decks, at('a', 1), secs)).toEqual({ kind: 'end', nextDeck: 'B', auto: false })
  })
  it('no sections keeps end', () => {
    expect(nextView(decks, at('a', 1, auto))).toEqual({ kind: 'end', nextDeck: 'B', auto: true })
  })
  it('a following deck in the same segment keeps end', () => {
    const one: SectionMeta[] = [{ id: 's1', name: 'All', at: 0 }]
    expect(nextView(decks, at('a', 1, auto), one)).toEqual({
      kind: 'end',
      nextDeck: 'B',
      auto: true
    })
  })
  it('canNextSection is false on the last segment, true elsewhere', () => {
    expect(canNextSection(decks, at('c', 0), secs)).toBe(false)
    expect(canNextSection(decks, at('a', 0), secs)).toBe(true)
    expect(canPrevSection(decks, at('c', 0), secs)).toBe(true)
    expect(canNextSection(decks, at('a', 0), [])).toBe(false)
  })
  it('canNextSection is true from a STANDBY position inside the first section', () => {
    const first: SectionMeta[] = [{ id: 's1', name: 'Part 1', at: 0 }]
    const standby = { ...at('a', 0), shown: null }
    expect(canNextSection(decks, standby, first)).toBe(true)
  })
  it('n and N follow shift, not case', () => {
    const target = null
    expect(keyToAction({ key: 'n', target })).toEqual({ type: 'nextSection' })
    expect(keyToAction({ key: 'N', shiftKey: true, target })).toEqual({ type: 'prevSection' })
    expect(keyToAction({ key: 'N', shiftKey: false, target })).toEqual({ type: 'nextSection' })
    expect(keyToAction({ key: 'n', repeat: true, target })).toBeNull()
    expect(
      keyToAction({ key: 'n', target: { tagName: 'INPUT' } as unknown as EventTarget })
    ).toBeNull()
  })
})

describe('outputGain', () => {
  const live = (audio?: { volume: number; muted: boolean }): ProgramState => ({
    ...initialState,
    shown: { deckId: 'd', index: 0, file: '0.png', ...(audio ? { audio } : {}) }
  })
  const master = (masterVolume: number, muted = false): AudioSettings => ({
    deviceId: null,
    muted,
    masterVolume,
    route: 'local'
  })

  it('is deck volume times master volume', () => {
    expect(outputGain(live({ volume: 50, muted: false }), master(50))).toBeCloseTo(0.25)
  })
  it('uses the deck gain alone while the settings are unknown', () => {
    expect(outputGain(live({ volume: 50, muted: false }), null)).toBeCloseTo(0.5)
  })
  it('is 1 with no live slide or no deck audio and default settings', () => {
    expect(outputGain(initialState, null)).toBe(1)
    expect(outputGain(live(), master(100))).toBe(1)
  })
  it('is 0 when the master is muted, or the deck is', () => {
    expect(outputGain(live({ volume: 50, muted: false }), master(50, true))).toBe(0)
    expect(outputGain(live({ volume: 50, muted: true }), master(50))).toBe(0)
  })
})

describe('deckSoundLabel', () => {
  it('is null for a deck at the default sound', () => {
    expect(deckSoundLabel(undefined)).toBeNull()
    expect(deckSoundLabel({ volume: 100, muted: false })).toBeNull()
  })
  it('says muted whatever the volume', () => {
    expect(deckSoundLabel({ volume: 100, muted: true })).toBe('Deck sound: muted')
    expect(deckSoundLabel({ volume: 60, muted: true })).toBe('Deck sound: muted')
  })
  it('gives the volume of a deck that is lowered', () => {
    expect(deckSoundLabel({ volume: 60, muted: false })).toBe('Deck sound: 60%')
    expect(deckSoundLabel({ volume: 0, muted: false })).toBe('Deck sound: 0%')
  })
})
