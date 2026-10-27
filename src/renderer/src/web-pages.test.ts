import { describe, it, expect } from 'vitest'
import { mergeStatuses } from './web-pages'

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
