import { describe, expect, it } from 'vitest'
import { formatTime, mediaEnded, mediaPosition, startClock } from './media'
import { initialState, reconcile, reduce, type ProgramState } from './program'
import type { DeckMeta } from './types'

const media: DeckMeta = {
  id: 'M',
  name: 'clip',
  source: 'media',
  width: 1920,
  height: 1080,
  slides: [{ file: '001.png', notes: '', video: '001.webm', duration: 10 }]
}
const still: DeckMeta = {
  id: 'S',
  name: 'deck',
  source: 'pdf',
  width: 1920,
  height: 1080,
  slides: [{ file: '001.png', notes: '' }]
}
const decks = [media, still]
const T0 = 1_000_000

function live(): ProgramState {
  return reduce(initialState, { type: 'selectDeck', deckId: 'M' }, decks, [], T0)
}

describe('media clock', () => {
  it('position runs while playing, wraps when looping, holds at the end otherwise', () => {
    const c = startClock(T0, 10)
    expect(mediaPosition(c, T0 + 4000)).toBe(4)
    expect(mediaPosition(c, T0 + 15000)).toBe(10)
    expect(mediaEnded(c, T0 + 15000)).toBe(true)
    expect(mediaPosition({ ...c, loop: true }, T0 + 13000)).toBe(3)
    expect(mediaEnded({ ...c, loop: true }, T0 + 13000)).toBe(false)
    expect(mediaPosition({ ...c, playing: false, at: 2 }, T0 + 9000)).toBe(2)
  })

  it('formatTime', () => {
    expect(formatTime(65.9)).toBe('1:05')
    expect(formatTime(3725)).toBe('1:02:05')
  })
})

describe('reduce: media actions', () => {
  it('taking a media deck starts its clock; other decks have none', () => {
    const s = live()
    expect(s.media).toEqual(startClock(T0, 10))
    const other = reduce(s, { type: 'selectDeck', deckId: 'S' }, decks, [], T0 + 1)
    expect(other.media).toBeUndefined()
  })

  it('pause keeps the position, play goes on from it', () => {
    const p = reduce(live(), { type: 'mediaPause' }, decks, [], T0 + 3000)
    expect(p.media).toMatchObject({ playing: false, at: 3 })
    const r = reduce(p, { type: 'mediaPlay' }, decks, [], T0 + 9000)
    expect(r.media).toMatchObject({ playing: true, at: 3, since: T0 + 9000 })
  })

  it('play at the end starts over and counts as a seek', () => {
    const s = live()
    const r = reduce(s, { type: 'mediaPlay' }, decks, [], T0 + 20000)
    expect(r.media).toMatchObject({ playing: true, at: 0, seek: 1 })
  })

  it('seek clamps to the length and rejects junk', () => {
    const s = live()
    expect(reduce(s, { type: 'mediaSeek', at: 99 }, decks, [], T0).media).toMatchObject({
      at: 10,
      seek: 1
    })
    expect(reduce(s, { type: 'mediaSeek', at: NaN }, decks, [], T0)).toBe(s)
  })

  it('freeze, black and fit changes keep the clock; a new take restarts it', () => {
    const s = live()
    const b = reduce(s, { type: 'toggleBlack' }, decks, [], T0 + 5000)
    expect(b.media).toBe(s.media)
    const again = reduce(b, { type: 'selectDeck', deckId: 'M' }, decks, [], T0 + 7000)
    expect(again.media).toEqual(startClock(T0 + 7000, 10))
  })

  it('media actions without media on air change nothing', () => {
    expect(reduce(initialState, { type: 'mediaPlay' }, decks)).toBe(initialState)
  })

  it('reconcile drops the clock when the media deck is gone', () => {
    expect(reconcile(live(), [still]).media).toBeUndefined()
  })
})
