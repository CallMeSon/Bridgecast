import { describe, expect, it } from 'vitest'
import { deckRowTag, webRowParts } from './deck-row'

describe('deckRowTag', () => {
  it.each(['live', 'frozen', 'black', 'kv'] as const)('%s on the shown deck', (t) => {
    expect(deckRowTag('a', 'a', t)).toBe(t)
  })
  it('a different deck has no tag', () => {
    expect(deckRowTag('b', 'a', 'live')).toBeNull()
    expect(deckRowTag('b', 'a', 'black')).toBeNull()
  })
  it('standby has no tag', () => {
    expect(deckRowTag('a', 'a', 'idle')).toBeNull()
  })
  it('black with nothing shown has no tag', () => {
    expect(deckRowTag('a', null, 'black')).toBeNull()
  })
})

describe('webRowParts', () => {
  it('off air keeps the chip alone', () => {
    expect(webRowParts(null, 'ready')).toEqual({ tag: null, chip: 'ready' })
    expect(webRowParts(null, 'hold')).toEqual({ tag: null, chip: 'hold' })
  })
  it.each(['live', 'frozen', 'black', 'kv'] as const)('%s hides a Ready chip', (t) => {
    expect(webRowParts(t, 'ready')).toEqual({ tag: t, chip: null })
  })
  it.each(['loading', 'error', 'hold'] as const)('on air keeps the %s chip', (c) => {
    expect(webRowParts('live', c)).toEqual({ tag: 'live', chip: c })
  })
})
