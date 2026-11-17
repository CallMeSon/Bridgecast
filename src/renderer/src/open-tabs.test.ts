import { describe, expect, it } from 'vitest'
import { closeTab, keepAirTab, openTab } from './open-tabs'

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `e${i}`)

describe('openTab', () => {
  it('does not duplicate', () => {
    expect(openTab(['a', 'b'], 'a', [])).toEqual(['a', 'b'])
  })
  it('over the cap drops the oldest not in keep', () => {
    const out = openTab(ids(8), 'new', ['e0', 'e1'])
    expect(out).toHaveLength(8)
    expect(out).toContain('e0')
    expect(out).toContain('e1')
    expect(out).not.toContain('e2')
    expect(out[out.length - 1]).toBe('new')
  })
  it('never drops current or air event', () => {
    const out = openTab(ids(8), 'new', ['e0', 'e7'])
    expect(out).toContain('e0')
    expect(out).toContain('e7')
    expect(out).toHaveLength(8)
  })
})

describe('closeTab', () => {
  it('current selects the left neighbour', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b')).toEqual({ ids: ['a', 'c'], next: 'a' })
  })
  it('first current selects the new first', () => {
    expect(closeTab(['a', 'b'], 'a', 'a')).toEqual({ ids: ['b'], next: 'b' })
  })
  it('another tab leaves the current one', () => {
    expect(closeTab(['a', 'b', 'c'], 'c', 'a')).toEqual({ ids: ['a', 'b'], next: 'a' })
  })
  it('last tab gives Home', () => {
    expect(closeTab(['a'], 'a', 'a')).toEqual({ ids: [], next: null })
  })
  it('unknown id changes nothing', () => {
    expect(closeTab(['a'], 'x', 'a')).toEqual({ ids: ['a'], next: 'a' })
  })
  it('closeTab refuses the locked tab', () => {
    const list = ['a', 'b']
    const r = closeTab(list, 'a', 'a', 'a')
    expect(r).toEqual({ ids: ['a', 'b'], next: 'a' })
    expect(r.ids).toBe(list)
  })
  it('closeTab still closes other tabs while one is locked', () => {
    expect(closeTab(['a', 'b', 'c'], 'b', 'b', 'a')).toEqual({ ids: ['a', 'c'], next: 'a' })
  })
})

describe('keepAirTab', () => {
  it('keepAirTab adds the air event back', () => {
    expect(keepAirTab(['b'], 'a', true)).toEqual(['b', 'a'])
  })
  it('keepAirTab leaves ids when off air or already open', () => {
    const x = ['b', 'c']
    expect(keepAirTab(x, 'a', false)).toBe(x)
    const y = ['a']
    expect(keepAirTab(y, 'a', true)).toBe(y)
    expect(keepAirTab(['b'], null, true)).toEqual(['b'])
  })
  it('keepAirTab respects MAX_TABS and keeps the air tab', () => {
    const out = keepAirTab(ids(8), 'a', true)
    expect(out).toHaveLength(8)
    expect(out).toContain('a')
  })
})
