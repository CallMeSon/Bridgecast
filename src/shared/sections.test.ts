import { describe, it, expect } from 'vitest'
import { orderItems, splitOrder, sanitizeSections, segmentsOf } from './sections'
import type { SectionMeta } from './types'

const sec = (id: string, at: number, name = id): SectionMeta => ({ id, name, at })

describe('orderItems', () => {
  it('places a section before the deck at its index', () => {
    expect(orderItems(['a', 'b', 'c'], [sec('s1', 1, 'One')])).toEqual([
      { deck: 'a' },
      { section: 's1' },
      { deck: 'b' },
      { deck: 'c' }
    ])
  })

  it('handles adjacent sections and both edges, and round-trips through splitOrder', () => {
    const sections = [sec('s0', 0), sec('s1', 2), sec('s2', 2), sec('s3', 3)]
    const items = orderItems(['a', 'b', 'c'], sections)
    expect(items).toEqual([
      { section: 's0' },
      { deck: 'a' },
      { deck: 'b' },
      { section: 's1' },
      { section: 's2' },
      { deck: 'c' },
      { section: 's3' }
    ])
    expect(splitOrder(items, sections)).toEqual({ deckIds: ['a', 'b', 'c'], sections })
  })
})

describe('splitOrder', () => {
  const sections = [sec('s1', 1, 'One')]

  it('recomputes at when a deck moves across a section', () => {
    const r = splitOrder([{ section: 's1' }, { deck: 'a' }, { deck: 'b' }, { deck: 'c' }], sections)
    expect(r.deckIds).toEqual(['a', 'b', 'c'])
    expect(r.sections).toEqual([sec('s1', 0, 'One')])
  })

  it('recomputes at when the section sits after two decks', () => {
    const r = splitOrder([{ deck: 'a' }, { deck: 'b' }, { section: 's1' }, { deck: 'c' }], sections)
    expect(r.sections[0].at).toBe(2)
  })
})

describe('sanitizeSections', () => {
  it('clamps at to the deck count', () => {
    expect(sanitizeSections([{ id: 'x', name: 'X', at: 9 }], 2)).toEqual([sec('x', 2, 'X')])
  })

  it('keeps only the first of a duplicate id', () => {
    const r = sanitizeSections(
      [
        { id: 'x', name: 'First', at: 0 },
        { id: 'x', name: 'Second', at: 1 }
      ],
      2
    )
    expect(r).toEqual([sec('x', 0, 'First')])
  })

  it('drops empty names, non-objects and bad ids', () => {
    expect(
      sanitizeSections([{ id: 'x', name: '', at: 0 }, null, 5, { id: 1, name: 'N', at: 0 }], 2)
    ).toEqual([])
  })

  it('returns [] for non-arrays', () => {
    expect(sanitizeSections(undefined, 2)).toEqual([])
  })

  it('sorts by at, stably', () => {
    const r = sanitizeSections(
      [
        { id: 'b', name: 'B', at: 2 },
        { id: 'a', name: 'A', at: 0 },
        { id: 'c', name: 'C', at: 2 }
      ],
      3
    )
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('segmentsOf', () => {
  const decks = ['a', 'b', 'c']

  it('returns one leading segment without sections', () => {
    expect(segmentsOf(decks, [])).toEqual([{ section: null, decks }])
  })

  it('splits into leading block and section', () => {
    const s1 = sec('s1', 1)
    expect(segmentsOf(decks, [s1])).toEqual([
      { section: null, decks: ['a'] },
      { section: s1, decks: ['b', 'c'] }
    ])
  })

  it('omits the leading block when empty', () => {
    const s1 = sec('s1', 0)
    expect(segmentsOf(decks, [s1])).toEqual([{ section: s1, decks }])
  })

  it('keeps an empty section in the middle', () => {
    const s1 = sec('s1', 1)
    const s2 = sec('s2', 1)
    expect(segmentsOf(decks, [s1, s2])).toEqual([
      { section: null, decks: ['a'] },
      { section: s1, decks: [] },
      { section: s2, decks: ['b', 'c'] }
    ])
  })

  it('clamps at beyond the deck count', () => {
    const s1 = sec('s1', 9)
    expect(segmentsOf(decks, [s1])).toEqual([
      { section: null, decks },
      { section: s1, decks: [] }
    ])
  })
})
