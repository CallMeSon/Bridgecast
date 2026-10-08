import { describe, it, expect } from 'vitest'
import * as path from 'path'
import { isInside, kvMimeType, parseKvUrl, parseSlideUrl } from './slide-protocol'
import { kvImageUrl, slideUrl } from '../shared/ipc'

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

const KV = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png'

describe('parseKvUrl', () => {
  it('parses event id and KV file for every allowed extension', () => {
    expect(parseKvUrl(`slide://kv/${ID}/${KV}`)).toEqual({ eventId: ID, file: KV })
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      const file = `3f2504e0-4f89-41d3-9a0c-0305e82c3301.${ext}`
      expect(parseKvUrl(`slide://kv/${ID}/${file}`)).toEqual({ eventId: ID, file })
    }
    expect(parseKvUrl(`slide://kv/${ID.toUpperCase()}/${KV}`)).toEqual({ eventId: ID, file: KV })
  })

  it('round-trips kvImageUrl', () => {
    expect(kvImageUrl(ID, KV)).toBe(`slide://kv/${ID}/${KV}`)
    expect(parseKvUrl(kvImageUrl(ID, KV))).toEqual({ eventId: ID, file: KV })
  })

  it('is not a deck URL and deck URLs are not KV URLs', () => {
    expect(parseSlideUrl(`slide://kv/${ID}/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://${ID}/001.png`)).toBeNull()
  })

  it('rejects bad hosts, ids, names, extensions, traversal and extras', () => {
    expect(parseKvUrl(`file://kv/${ID}/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://other/${ID}/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/not-a-uuid/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/logo.png`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/001.png`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/${KV.replace('.png', '.gif')}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/${KV.replace('.png', '.PNG')}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/../events.json`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/%2e%2e/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/a/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/${KV}?x=1`)).toBeNull()
    expect(parseKvUrl(`slide://kv/${ID}/${KV}#x`)).toBeNull()
    expect(parseKvUrl(`slide://kv:80/${ID}/${KV}`)).toBeNull()
    expect(parseKvUrl(`slide://user@kv/${ID}/${KV}`)).toBeNull()
    expect(parseKvUrl('garbage')).toBeNull()
  })
})

describe('kvMimeType', () => {
  it('maps extensions to image types', () => {
    expect(kvMimeType('a.png')).toBe('image/png')
    expect(kvMimeType('a.jpg')).toBe('image/jpeg')
    expect(kvMimeType('a.jpeg')).toBe('image/jpeg')
    expect(kvMimeType('a.webp')).toBe('image/webp')
    expect(kvMimeType('a.gif')).toBeNull()
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
