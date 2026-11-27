import { describe, it, expect } from 'vitest'
import * as path from 'path'
import {
  isInside,
  kvMimeType,
  parseKvUrl,
  parseRange,
  parseSlideUrl,
  parseThumbUrl,
  thumbFileName
} from './slide-protocol'
import { kvImageUrl, slideUrl, thumbUrl } from '../shared/ipc'

const ID = '0b5e8f3a-9d2c-4f1e-8a7b-6c5d4e3f2a1b'

describe('parseThumbUrl', () => {
  it('parses a thumbnail URL into the slide file and round-trips thumbUrl', () => {
    expect(parseThumbUrl(`slide://${ID}/thumbs/003.jpg`)).toEqual({ deckId: ID, file: '003.png' })
    expect(parseThumbUrl(thumbUrl(ID, '012.png'))).toEqual({ deckId: ID, file: '012.png' })
    expect(thumbUrl(ID, '001.png')).toBe(`slide://${ID}/thumbs/001.jpg`)
    expect(thumbFileName('001.png')).toBe('001.jpg')
  })

  it('rejects everything else', () => {
    for (const bad of [
      'slide://not-a-uuid/thumbs/001.jpg',
      `slide://${ID}/thumbs/001.png`,
      `slide://${ID}/thumbs/01.jpg`,
      `slide://${ID}/thumbs/../events.json`,
      `slide://${ID}/thumbs/a/001.jpg`,
      `slide://${ID}/thumbs/001.jpg?x=1`,
      `slide://${ID}/thumbs/001.jpg#x`,
      `slide://${ID}/thumbs/`,
      `file://${ID}/thumbs/001.jpg`,
      `slide://kv/thumbs/001.jpg`
    ]) {
      expect(parseThumbUrl(bad), bad).toBeNull()
    }
  })

  it('is not accepted as a slide URL', () => {
    expect(parseSlideUrl(`slide://${ID}/thumbs/001.jpg`)).toBeNull()
  })
})

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

  it('accepts a cache-busting ?v=<n> on a slide or thumbnail (rewritten web snapshot)', () => {
    expect(parseSlideUrl(`slide://${ID}/001.png?v=12`)).toEqual({ deckId: ID, file: '001.png' })
    expect(parseThumbUrl(`slide://${ID}/thumbs/001.jpg?v=3`)).toEqual({
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
    expect(parseSlideUrl(`slide://${ID}/001.png?v=abc`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/001.png?v=1&x=2`)).toBeNull()
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

describe('video URLs', () => {
  it('parseSlideUrl accepts NNN.<video ext> and nothing else video-like', () => {
    expect(parseSlideUrl(`slide://${ID}/003.mp4`)).toEqual({ deckId: ID, file: '003.mp4' })
    expect(parseSlideUrl(`slide://${ID}/003.webm`)).toEqual({ deckId: ID, file: '003.webm' })
    expect(parseSlideUrl(`slide://${ID}/003.avi`)).toBeNull()
    // The URL parser already collapses a plain `/../`; encoded or nested forms must not match.
    expect(parseSlideUrl(`slide://${ID}/..%2F003.mp4`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/x/003.mp4`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/003.mp4?x=1`)).toBeNull()
  })
})

describe('parseRange', () => {
  it('parses single byte ranges', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('rejects a zero-length suffix', () => {
    expect(parseRange('bytes=-0', 1000)).toBe('invalid')
  })

  it('flags an unsatisfiable range and ignores the rest', () => {
    expect(parseRange('bytes=2000-', 1000)).toBe('invalid')
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull()
    expect(parseRange(null, 1000)).toBeNull()
  })
})

describe('parseSlideUrl source.pdf', () => {
  it('accepts source.pdf', () => {
    expect(parseSlideUrl(`slide://${ID}/source.pdf`)).toEqual({ deckId: ID, file: 'source.pdf' })
  })
  it('refuses source.pptx and original.pptx', () => {
    expect(parseSlideUrl(`slide://${ID}/source.pptx`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/original.pptx`)).toBeNull()
    expect(parseSlideUrl(`slide://${ID}/original.pdf`)).toBeNull()
  })
})
