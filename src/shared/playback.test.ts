import { describe, it, expect } from 'vitest'
import { canNative, defaultPlayback, engineStates, playbackOf } from './playback'
import type { DeckMeta } from './types'

const deck = (over: Partial<DeckMeta>): DeckMeta => ({
  id: 'x',
  name: 'x',
  source: 'pptx',
  width: 1,
  height: 1,
  slides: [],
  ...over
})

describe('defaultPlayback', () => {
  it.each([
    ['pptx', true, 'vector'],
    ['pptx', false, 'native'],
    ['pdf', true, 'vector'],
    ['pdf', false, 'vector'],
    ['folder', false, 'images'],
    ['web', false, 'images']
  ] as const)('%s static=%s -> %s', (source, isStatic, want) => {
    expect(defaultPlayback(source, isStatic)).toBe(want)
  })
})

describe('playbackOf and canNative', () => {
  it('a deck without playback is images', () => {
    expect(playbackOf(deck({}))).toBe('images')
  })
  it('a bogus stored value is images', () => {
    expect(playbackOf(deck({ playback: 'zoom' as never }))).toBe('images')
  })
  it('returns the stored mode', () => {
    expect(playbackOf(deck({ playback: 'native' }))).toBe('native')
  })
  it('only pptx can be native', () => {
    expect(canNative(deck({ source: 'pptx' }))).toBe(true)
    expect(canNative(deck({ source: 'pdf' }))).toBe(false)
    expect(canNative(deck({ source: 'folder' }))).toBe(false)
  })
})

describe('engineStates', () => {
  const nat = (id: string): DeckMeta => deck({ id, playback: 'native' })
  const decks = [nat('a'), nat('b'), nat('f'), deck({ id: 'c', playback: 'vector' })]
  it('lists native decks only: ready, opening or fallback', () => {
    expect(
      engineStates(decks, { ready: (id) => id === 'a', fellBack: (id) => id === 'f' })
    ).toEqual({ a: 'ready', b: 'opening', f: 'fallback' })
  })
})
