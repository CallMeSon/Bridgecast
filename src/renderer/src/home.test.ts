import { describe, expect, it } from 'vitest'
import type { EventMeta, EventSummary } from '../../shared/types'
import { eventSubLine, FILTER_LABEL, homeList, RECENT_MAX, type HomeOptions } from './home'

const ev = (id: string, o: Partial<EventMeta> = {}): EventMeta => ({
  id,
  name: id,
  deckIds: [],
  ...o
})
const sm = (id: string, o: Partial<EventSummary> = {}): EventSummary => ({
  id,
  deckCount: 0,
  deckNames: [],
  hasWeb: false,
  first: null,
  ...o
})
const opts = (o: Partial<HomeOptions> = {}): HomeOptions => ({
  tab: 'recent',
  filter: 'all',
  query: '',
  airEvent: null,
  onAir: false,
  ...o
})
const ids = (l: EventMeta[]): string[] => l.map((e) => e.id)

describe('homeList', () => {
  const events = [
    ev('old', { lastOpened: 1 }),
    ev('new', { lastOpened: 9 }),
    ev('arch', { lastOpened: 5, archived: true }),
    ev('nodate')
  ]
  it('recent hides archived, sorts by lastOpened, then file order', () => {
    expect(ids(homeList(events, [], opts()))).toEqual(['new', 'old', 'nodate'])
  })
  it('createdAt breaks lastOpened ties', () => {
    const l = [ev('a', { createdAt: 1 }), ev('b', { createdAt: 2 })]
    expect(ids(homeList(l, [], opts()))).toEqual(['b', 'a'])
  })
  it('all includes archived; archive only archived', () => {
    expect(ids(homeList(events, [], opts({ tab: 'all' })))).toEqual([
      'new',
      'arch',
      'old',
      'nodate'
    ])
    expect(ids(homeList(events, [], opts({ tab: 'archive' })))).toEqual(['arch'])
  })
  it('recent is capped at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ev(`e${i}`, { lastOpened: i }))
    expect(homeList(many, [], opts())).toHaveLength(RECENT_MAX)
    expect(homeList(many, [], opts({ tab: 'all' }))).toHaveLength(20)
  })
  it('filters', () => {
    const s = [sm('old', { hasWeb: true, deckCount: 1 }), sm('new', { deckCount: 2 })]
    expect(ids(homeList(events, s, opts({ filter: 'web' })))).toEqual(['old'])
    expect(ids(homeList(events, s, opts({ filter: 'empty' })))).toEqual(['nodate'])
    const live = opts({ filter: 'live', airEvent: 'old', onAir: true })
    expect(ids(homeList(events, s, live))).toEqual(['old'])
    expect(homeList(events, s, { ...live, onAir: false })).toEqual([])
  })
  it('search matches name and deck names, trimmed, case-insensitive', () => {
    const l = [ev('Annual Meeting'), ev('Other')]
    const s = [sm('Other', { deckNames: ['Keynote Deck'] })]
    expect(ids(homeList(l, s, opts({ query: '  annual ' })))).toEqual(['Annual Meeting'])
    expect(ids(homeList(l, s, opts({ query: 'KEYNOTE' })))).toEqual(['Other'])
  })
  it('air event first when on air', () => {
    expect(ids(homeList(events, [], opts({ airEvent: 'old', onAir: true })))).toEqual([
      'old',
      'new',
      'nodate'
    ])
    expect(ids(homeList(events, [], opts({ airEvent: 'old', onAir: false })))[0]).toBe('new')
  })
  it('air event archived is pinned first in All', () => {
    const o = opts({ tab: 'all', airEvent: 'arch', onAir: true })
    expect(ids(homeList(events, [], o))[0]).toBe('arch')
  })
})

describe('eventSubLine', () => {
  const now = new Date(2026, 10, 1, 20, 0).getTime()
  const at = (mo: number, d: number, h: number, m: number): number =>
    new Date(2026, mo, d, h, m).getTime()
  const opened = (t: number): EventMeta => ev('a', { deckIds: ['x', 'y'], lastOpened: t })
  it('counts decks', () => {
    expect(eventSubLine(ev('a'), undefined, now)).toBe('No decks yet')
    expect(eventSubLine(ev('a'), sm('a', { deckCount: 1 }), now)).toBe('1 deck')
    expect(eventSubLine(ev('a'), sm('a', { deckCount: 4 }), now)).toBe('4 decks')
  })
  it('opened wordings', () => {
    expect(eventSubLine(opened(now - 5000), undefined, now)).toBe('2 decks · Opened this minute')
    expect(eventSubLine(opened(at(10, 1, 18, 40)), undefined, now)).toBe(
      '2 decks · Opened today, 18:40'
    )
    expect(eventSubLine(opened(at(9, 31, 9, 5)), undefined, now)).toBe(
      '2 decks · Opened yesterday, 09:05'
    )
    expect(eventSubLine(opened(at(9, 12, 8, 0)), undefined, now)).toBe('2 decks · Opened 12 Oct')
  })
  it('created, archived, none', () => {
    const created = ev('a', { createdAt: at(9, 28, 8, 0) })
    expect(eventSubLine(created, undefined, now)).toBe('No decks yet · Created 28 Oct')
    const arch = ev('a', { archived: true, lastOpened: now })
    expect(eventSubLine(arch, undefined, now)).toBe('No decks yet · Archived')
  })
})

describe('FILTER_LABEL', () => {
  it('labels', () => {
    expect(FILTER_LABEL.all).toBe('Filter')
    expect(FILTER_LABEL.web).toBe('With web pages')
  })
})
