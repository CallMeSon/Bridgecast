import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { isInside, parseSlideUrl } from './slide-protocol'
import { slideUrl } from '../shared/ipc'

const ID = '0b5e8f3a-9d2c-4f1e-8a7b-6c5d4e3f2a1b'

describe('parseSlideUrl', () => {
  it('parses deck id and slide file', () => {
    expect(parseSlideUrl(`slide://${ID}/001.png`)).toEqual({ deckId: ID, file: '001.png' })
    expect(parseSlideUrl(`slide://${ID}/012.png`)).toEqual({ deckId: ID, file: '012.png' })
    expect(parseSlideUrl(`slide://${ID}/1234.png`)).toEqual({ deckId: ID, file: '1234.png' })
    expect(parseSlideUrl(`slide://${ID.toUpperCase()}/001.png`)).toEqual({
      deckId: ID,
      file: '001.png'
    })
  })

  it('round-trips slideUrl', () => {
    expect(parseSlideUrl(slideUrl(ID, '007.png'))).toEqual({ deckId: ID, file: '007.png' })
  })

  it('rejects other schemes, bad ids, bad indices and traversal', () => {
    expect(parseSlideUrl(`file://${ID}/0.png`)).toBeNull()
    expect(parseSlideUrl('slide://not-a-uuid/0.png')).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/-1.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/1.5.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/0.jpg`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/../events.json`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/a/0.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/001.png?x=1`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/001.png#x`)).toBeNull()
    // Index-style names are not slide files (files are 001.png, 002.png, ...).
    expect(parseSlideUrl(`slide://${ID}/0.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/12.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/0001234.png`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/001.PNG`)).toBeNull()
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
