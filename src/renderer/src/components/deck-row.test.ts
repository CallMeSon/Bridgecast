import { describe, expect, it } from 'vitest'
import { deckRowTag } from './deck-row'

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
