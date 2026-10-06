import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { isInside, parseSlideUrl } from './slide-protocol'

const ID = '0b5e8f3a-9d2c-4f1e-8a7b-6c5d4e3f2a1b'

describe('parseSlideUrl', () => {
  it('parses deck id and index', () => {
    expect(parseSlideUrl(`slide://${ID}/0.png`)).toEqual({ deckId: ID, index: 0 })
    expect(parseSlideUrl(`slide://${ID}/12.png`)).toEqual({ deckId: ID, index: 12 })
  })

  it('rejects other schemes, bad ids, bad indices and traversal', () => {
    expect(parseSlideUrl(`file://${ID}/0.png`)).toBeNull()
    expect(parseSlideUrl('slide://not-a-uuid/0.png')).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/-1.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/1.5.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/0.jpg`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/../events.json`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/a/0.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/0.png?x=1`)).toBeNull()
    expect(parseSlideUrl('garbage')).toBeNull()
  })
})

describe('isInside', () => {
  const root = path.resolve('/lib')
  it('accepts files under root', () => {
    expect(isInside(root, path.join(root, 'decks', ID, '001.png'))).toBe(true)
  })
  it('rejects root itself and paths outside', () => {
    expect(isInside(root, root)).toBe(false)
    expect(isInside(root, path.join(root, '..', 'other', 'x.png'))).toBe(false)
    expect(isInside(root, path.resolve('/elsewhere/x.png'))).toBe(false)
  })
})
