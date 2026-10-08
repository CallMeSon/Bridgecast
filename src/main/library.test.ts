import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Library } from './library'
import { DECK_NAME_MAX } from '../shared/types'

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
    expect(lib2.getDecks(ev.id)[0].slides.map((s) => s.notes)).toEqual([
      'note-2',
      'note-0',
      'note-1'
    ])
  })

  it('slideFilePath serves a slide by its file, before and after a reorder', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(3))
    const p = lib.slideFilePath(d.id, '002.png')
    expect(p).toBe(path.join(root, 'decks', d.id, '002.png'))
    lib.reorderSlides(d.id, [1, 2, 0])
    expect(lib.slideFilePath(d.id, '002.png')).toBe(p)
    expect(fs.readFileSync(p, 'utf8')).toBe('png-1')
    expect(() => lib.slideFilePath(d.id, '004.png')).toThrow(/tidak ditemukan/)
    expect(() => lib.slideFilePath(d.id, 'deck.json')).toThrow(/tidak ditemukan/)
    expect(() => lib.slideFilePath('..', '001.png')).toThrow(/tidak valid/)
  })

  it('getDeck returns one deck by id', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(2, 'Satu'))
    expect(lib.getDeck(d.id)).toMatchObject({ id: d.id, name: 'Satu' })
    expect(() => lib.getDeck('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toThrow(/tidak ditemukan/)
  })

  it('reorderSlides rejects an invalid permutation and keeps state', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(3))
    expect(() => lib.reorderSlides(d.id, [0, 0, 1])).toThrow(/urutan/i)
    expect(() => lib.reorderSlides(d.id, [0, 1])).toThrow(/urutan/i)
    expect(lib.getDecks(ev.id)[0].slides.map((s) => s.notes)).toEqual([
      'note-0',
      'note-1',
      'note-2'
    ])
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

  it('renameDeck trims, saves, and keeps slides and order', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const a = lib.addDeck(ev.id, deckInput(2, 'Sesi 2 Paradigma'))
    const b = lib.addDeck(ev.id, deckInput(1, 'B'))
    const r = lib.renameDeck(ev.id, a.id, '  Sesi 1 - Pengenalan materi  ')
    expect(r.name).toBe('Sesi 1 - Pengenalan materi')
    expect(r.slides).toEqual(a.slides)
    const again = new Library(root)
    expect(again.getDecks(ev.id).map((d) => d.name)).toEqual(['Sesi 1 - Pengenalan materi', 'B'])
    expect(again.getDeck(b.id).name).toBe('B')
  })

  it('renameDeck rejects an empty or too long name and a deck of another event', () => {
    const lib = new Library(root)
    const e1 = lib.createEvent('E1')
    const e2 = lib.createEvent('E2')
    const d = lib.addDeck(e1.id, deckInput(1, 'Asli'))
    expect(() => lib.renameDeck(e1.id, d.id, '   ')).toThrow(/kosong/)
    expect(() => lib.renameDeck(e1.id, d.id, 'x'.repeat(121))).toThrow(/120 karakter/)
    expect(() => lib.renameDeck(e2.id, d.id, 'Baru')).toThrow(/tidak ditemukan/)
    expect(lib.getDeck(d.id).name).toBe('Asli')
  })

  it('renameDeck counts code points and rejects control or format characters', () => {
    const lib = new Library(root)
    const e1 = lib.createEvent('E1')
    const d = lib.addDeck(e1.id, deckInput(1, 'Asli'))
    // 120 astral characters are 240 UTF-16 units but 120 code points: accepted.
    const ok = '😀'.repeat(DECK_NAME_MAX)
    expect(lib.renameDeck(e1.id, d.id, ok).name).toBe(ok)
    expect(() => lib.renameDeck(e1.id, d.id, '😀'.repeat(DECK_NAME_MAX + 1))).toThrow(
      /120 karakter/
    )
    for (const bad of ['a\u0000b', 'a\nb', 'a\tb', 'a‮b', 'a​b', 'a\u007Fb']) {
      expect(() => lib.renameDeck(e1.id, d.id, bad)).toThrow(/karakter yang tidak didukung/)
    }
    expect(lib.getDeck(d.id).name).toBe(ok)
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

  describe('KV', () => {
    const img = (name: string, content = 'kv-1'): string => {
      const p = path.join(src, name)
      fs.writeFileSync(p, content)
      return p
    }
    const kvDir = (id: string): string => path.join(root, 'kv', id)

    it('setKv copies the image under a fresh name and saves it', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const r = lib.setKv(ev.id, img('Logo.PNG'))
      expect(r.kv).toMatch(/^[0-9a-f-]{36}\.png$/)
      expect(fs.readFileSync(lib.kvFilePath(ev.id, r.kv!), 'utf8')).toBe('kv-1')
      expect(fs.readdirSync(kvDir(ev.id))).toEqual([r.kv])
      expect(new Library(root).listEvents()[0].kv).toBe(r.kv)
      expect(lib.listEvents()[0].kv).toBe(r.kv)
    })

    it('a new KV gets a new file name and removes the previous file', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const a = lib.setKv(ev.id, img('a.jpg', 'A')).kv!
      const b = lib.setKv(ev.id, img('b.webp', 'B')).kv!
      expect(b).not.toBe(a)
      expect(b.endsWith('.webp')).toBe(true)
      expect(fs.readdirSync(kvDir(ev.id))).toEqual([b])
      expect(() => lib.kvFilePath(ev.id, a)).toThrow(/KV/)
    })

    it('accepts png, jpg, jpeg and webp in any case; refuses other formats', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      for (const n of ['a.png', 'b.JPG', 'c.jpeg', 'd.WebP']) {
        expect(lib.setKv(ev.id, img(n)).kv).toBeTruthy()
      }
      expect(() => lib.setKv(ev.id, img('x.gif'))).toThrow(
        'Format KV tidak didukung. Pilih gambar PNG, JPG, atau WebP.'
      )
      expect(() => lib.setKv(ev.id, img('x.pdf'))).toThrow(/Format KV tidak didukung/)
      expect(() => lib.setKv(ev.id, img('noext'))).toThrow(/Format KV tidak didukung/)
    })

    it('refuses a missing file, a folder and a file over 50 MB; keeps the old KV', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const old = lib.setKv(ev.id, img('ok.png')).kv
      expect(() => lib.setKv(ev.id, path.join(src, 'hilang.png'))).toThrow(/tidak ditemukan/)
      const dir = path.join(src, 'folder.png')
      fs.mkdirSync(dir)
      expect(() => lib.setKv(ev.id, dir)).toThrow(/bukan file/)
      const big = path.join(src, 'big.png')
      fs.closeSync(fs.openSync(big, 'w'))
      fs.truncateSync(big, 50 * 1024 * 1024 + 1)
      expect(() => lib.setKv(ev.id, big)).toThrow(/50 MB/)
      expect(lib.listEvents()[0].kv).toBe(old)
      expect(fs.readdirSync(kvDir(ev.id))).toEqual([old])
    })

    it('refuses an unknown event', () => {
      const lib = new Library(root)
      expect(() => lib.setKv('nope', img('a.png'))).toThrow(/Event tidak ditemukan/)
      expect(() => lib.clearKv('nope')).toThrow(/Event tidak ditemukan/)
    })

    it('every event has its own KV', () => {
      const lib = new Library(root)
      const e1 = lib.createEvent('E1')
      const e2 = lib.createEvent('E2')
      lib.setKv(e1.id, img('a.png'))
      expect(lib.listEvents().map((e) => e.kv !== undefined)).toEqual([true, false])
      lib.clearKv(e1.id)
      lib.setKv(e2.id, img('b.png'))
      expect(lib.listEvents().map((e) => e.kv !== undefined)).toEqual([false, true])
    })

    it('clearKv removes the file and the field, and is harmless without a KV', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      expect(lib.clearKv(ev.id).kv).toBeUndefined()
      const kv = lib.setKv(ev.id, img('a.png')).kv!
      const r = lib.clearKv(ev.id)
      expect('kv' in r).toBe(false)
      expect(fs.existsSync(path.join(kvDir(ev.id), kv))).toBe(false)
      expect('kv' in new Library(root).listEvents()[0]).toBe(false)
    })

    it('kvFilePath only resolves the stored file name', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const kv = lib.setKv(ev.id, img('a.png')).kv!
      expect(lib.kvFilePath(ev.id, kv)).toBe(path.join(root, 'kv', ev.id, kv))
      for (const bad of [
        '../events.json',
        '..\\events.json',
        '../../kv/' + ev.id + '/' + kv,
        kv.toUpperCase().replace('.PNG', '.png'),
        kv + '/',
        '',
        'events.json',
        '3f2504e0-4f89-41d3-9a0c-0305e82c3301.png'
      ]) {
        expect(() => lib.kvFilePath(ev.id, bad)).toThrow(/KV/)
      }
      expect(() => lib.kvFilePath('nope', kv)).toThrow(/Event tidak ditemukan/)
    })
  })
})
