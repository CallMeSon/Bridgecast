import { describe, it, expect } from 'vitest'
import { mergeStatuses, mergeWarnings } from './web-pages'

describe('mergeStatuses', () => {
  it('takes the list when no event came first', () => {
    expect(mergeStatuses({}, [{ deckId: 'a', status: 'loading' }], new Set())).toEqual({
      a: 'loading'
    })
  })

  it('keeps a page the list does not know when its event came first (startup race)', () => {
    const prev = { a: 'loading' as const }
    expect(mergeStatuses(prev, [], new Set(['a']))).toEqual({ a: 'loading' })
  })

  it('a newer event wins over the list entry', () => {
    const prev = { a: 'ready' as const }
    expect(mergeStatuses(prev, [{ deckId: 'a', status: 'loading' }], new Set(['a']))).toEqual({
      a: 'ready'
    })
  })

  it('list entries without an event are kept and closed pages drop out', () => {
    const prev = { gone: 'ready' as const, b: 'ready' as const }
    const list = [
      { deckId: 'b', status: 'error' as const },
      { deckId: 'c', status: 'loading' as const }
    ]
    expect(mergeStatuses(prev, list, new Set(['b']))).toEqual({ b: 'ready', c: 'loading' })
  })
})

describe('mergeWarnings', () => {
  it('takes warnings from the list, keeps newer event values and drops pages without one', () => {
    const prev = { a: 'old a', b: 'event b' }
    const list = [
      { deckId: 'a', warning: 'list a' },
      { deckId: 'b' },
      { deckId: 'c', warning: 'list c' },
      { deckId: 'd' }
    ]
    expect(mergeWarnings(prev, list, new Set(['b']))).toEqual({
      a: 'list a',
      b: 'event b',
      c: 'list c'
    })
  })
  it('a touched page whose event cleared the warning stays without one', () => {
    expect(mergeWarnings({}, [{ deckId: 'a', warning: 'x' }], new Set(['a']))).toEqual({})
  })
})
