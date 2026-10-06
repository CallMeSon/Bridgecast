import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Library } from './library'

let root: string
let src: string

function makePngs(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const p = path.join(src, `s${i}.png`)
    fs.writeFileSync(p, `png-${i}`)
    return p
  })
}

function deckInput(n = 3, name = 'Deck'): Parameters<Library['addDeck']>[1] {
  return {
    name,
    source: 'pptx',
    width: 1920,
    height: 1080,
    slides: makePngs(n).map((pngPath, i) => ({ pngPath, notes: `note-${i}` }))
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-root-'))
  src = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-src-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(src, { recursive: true, force: true })
})

describe('Library', () => {
  it('createEvent trims name and rejects empty', () => {
    const lib = new Library(root)
    expect(lib.createEvent('  Gala  ').name).toBe('Gala')
    expect(() => lib.createEvent('   ')).toThrow('Nama event kosong')
  })

  it('addDeck copies PNGs and getDecks returns in event order', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const a = lib.addDeck(ev.id, deckInput(2, 'A'))
    const b = lib.addDeck(ev.id, deckInput(1, 'B'))
    expect(fs.readFileSync(path.join(root, 'decks', a.id, '001.png'), 'utf8')).toBe('png-0')
    expect(fs.readFileSync(path.join(root, 'decks', a.id, '002.png'), 'utf8')).toBe('png-1')
    expect(a.slides.map((s) => s.file)).toEqual(['001.png', '002.png'])
    expect(lib.getDecks(ev.id).map((d) => d.name)).toEqual(['A', 'B'])
    lib.reorderDecks(ev.id, [b.id, a.id])
    expect(lib.getDecks(ev.id).map((d) => d.name)).toEqual(['B', 'A'])
  })

  it('persists across instances', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput())
    const lib2 = new Library(root)
    expect(lib2.listEvents().map((e) => e.name)).toEqual(['E'])
    expect(lib2.getDecks(ev.id)[0].id).toBe(d.id)
    expect(lib2.getDecks(ev.id)[0].slides).toHaveLength(3)
  })

  it('reorderSlides reorders slides with notes and files', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(3))
    lib.reorderSlides(d.id, [2, 0, 1])
    const got = lib.getDecks(ev.id)[0]
    expect(got.slides.map((s) => s.notes)).toEqual(['note-2', 'note-0', 'note-1'])
    expect(fs.readFileSync(lib.slidePath(d.id, 0), 'utf8')).toBe('png-2')
    expect(fs.readFileSync(lib.slidePath(d.id, 2), 'utf8')).toBe('png-1')
    const lib2 = new Library(root)
    expect(fs.readFileSync(lib2.slidePath(d.id, 0), 'utf8')).toBe('png-2')
    expect(lib2.getDecks(ev.id)[0].slides.map((s) => s.notes)).toEqual(['note-2', 'note-0', 'note-1'])
  })

  it('reorderSlides rejects an invalid permutation and keeps state', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(3))
    expect(() => lib.reorderSlides(d.id, [0, 0, 1])).toThrow(/urutan/i)
    expect(() => lib.reorderSlides(d.id, [0, 1])).toThrow(/urutan/i)
    expect(lib.getDecks(ev.id)[0].slides.map((s) => s.notes)).toEqual(['note-0', 'note-1', 'note-2'])
  })

  it('reorderDecks rejects incomplete or unknown ids and keeps order', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const a = lib.addDeck(ev.id, deckInput(1, 'A'))
    const b = lib.addDeck(ev.id, deckInput(1, 'B'))
    expect(() => lib.reorderDecks(ev.id, [a.id])).toThrow()
    expect(() => lib.reorderDecks(ev.id, [a.id, 'nope'])).toThrow()
    expect(lib.getDecks(ev.id).map((d) => d.id)).toEqual([a.id, b.id])
    expect(lib.listEvents()[0].deckIds).toEqual([a.id, b.id])
  })

  it('reorderSlides leaves PNG files untouched and consistent', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(3))
    const before = fs.readdirSync(path.join(root, 'decks', d.id)).sort()
    lib.reorderSlides(d.id, [1, 2, 0])
    expect(fs.readdirSync(path.join(root, 'decks', d.id)).sort()).toEqual(before)
    expect(fs.readFileSync(lib.slidePath(d.id, 2), 'utf8')).toBe('png-0')
  })

  it('removeDeck rejects traversal and foreign ids, deleting nothing', () => {
    const lib = new Library(root)
    const e1 = lib.createEvent('E1')
    const e2 = lib.createEvent('E2')
    const d1 = lib.addDeck(e1.id, deckInput(1))
    expect(() => lib.removeDeck(e1.id, '..')).toThrow(/tidak valid|tidak ditemukan/)
    expect(() => lib.removeDeck(e2.id, d1.id)).toThrow(/tidak ditemukan/)
    expect(fs.existsSync(path.join(root, 'events.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'decks', d1.id, 'deck.json'))).toBe(true)
    expect(lib.getDecks(e1.id)).toHaveLength(1)
  })

  it('slidePath and lookups throw Indonesian errors', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(1))
    expect(() => lib.slidePath(d.id, 5)).toThrow(/Slide tidak ditemukan\. /)
    expect(() => lib.slidePath('..', 0)).toThrow(/Id deck tidak valid/)
    expect(() => lib.slidePath('00000000-0000-4000-8000-000000000000', 0)).toThrow(
      /Deck tidak ditemukan\. /
    )
    expect(() => lib.getDecks('nope')).toThrow(/Event tidak ditemukan\. /)
  })

  it('corrupt events.json gives an Indonesian error', () => {
    fs.writeFileSync(path.join(root, 'events.json'), '{not json')
    expect(() => new Library(root)).toThrow(/events\.json rusak/)
  })

  it('removeDeck deletes folder and id', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(1))
    lib.removeDeck(ev.id, d.id)
    expect(fs.existsSync(path.join(root, 'decks', d.id))).toBe(false)
    expect(lib.listEvents()[0].deckIds).toEqual([])
    expect(lib.getDecks(ev.id)).toEqual([])
  })
})
