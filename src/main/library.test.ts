import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Library } from './library'
import { DECK_NAME_MAX } from '../shared/types'
import { orderItems } from '../shared/sections'

// fs namespace objects cannot be spied on in ESM; route copyFileSync through a hook.
const hooks = vi.hoisted(() => ({
  copy: null as null | ((src: string, dest: string) => void)
}))
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const copyFileSync: typeof actual.copyFileSync = (s, d, m) =>
    hooks.copy ? hooks.copy(String(s), String(d)) : actual.copyFileSync(s, d, m)
  return { ...actual, default: { ...actual, copyFileSync }, copyFileSync }
})

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
    expect(() => lib.createEvent('   ')).toThrow('Event name is empty')
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
    lib.reorder(ev.id, [{ deck: b.id }, { deck: a.id }])
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
    expect(() => lib.slideFilePath(d.id, '004.png')).toThrow(/not found/)
    expect(() => lib.slideFilePath(d.id, 'deck.json')).toThrow(/not found/)
    expect(() => lib.slideFilePath('..', '001.png')).toThrow(/not valid/)
  })

  it('getDeck returns one deck by id', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(2, 'One'))
    expect(lib.getDeck(d.id)).toMatchObject({ id: d.id, name: 'One' })
    expect(() => lib.getDeck('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toThrow(/not found/)
  })

  it('reorderSlides rejects an invalid permutation and keeps state', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(3))
    expect(() => lib.reorderSlides(d.id, [0, 0, 1])).toThrow(/slide order/i)
    expect(() => lib.reorderSlides(d.id, [0, 1])).toThrow(/slide order/i)
    expect(lib.getDecks(ev.id)[0].slides.map((s) => s.notes)).toEqual([
      'note-0',
      'note-1',
      'note-2'
    ])
  })

  it('reorder rejects incomplete or unknown ids and keeps order', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const a = lib.addDeck(ev.id, deckInput(1, 'A'))
    const b = lib.addDeck(ev.id, deckInput(1, 'B'))
    expect(() => lib.reorder(ev.id, [{ deck: a.id }])).toThrow()
    expect(() => lib.reorder(ev.id, [{ deck: a.id }, { deck: 'nope' }])).toThrow()
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
    const r = lib.renameDeck(ev.id, a.id, '  Session 1: Introduction  ')
    expect(r.name).toBe('Session 1: Introduction')
    expect(r.slides).toEqual(a.slides)
    const again = new Library(root)
    expect(again.getDecks(ev.id).map((d) => d.name)).toEqual(['Session 1: Introduction', 'B'])
    expect(again.getDeck(b.id).name).toBe('B')
  })

  it('renameDeck rejects an empty or too long name and a deck of another event', () => {
    const lib = new Library(root)
    const e1 = lib.createEvent('E1')
    const e2 = lib.createEvent('E2')
    const d = lib.addDeck(e1.id, deckInput(1, 'Original'))
    expect(() => lib.renameDeck(e1.id, d.id, '   ')).toThrow(/empty/)
    expect(() => lib.renameDeck(e1.id, d.id, 'x'.repeat(121))).toThrow(/120 characters/)
    expect(() => lib.renameDeck(e2.id, d.id, 'New')).toThrow(/not found/)
    expect(lib.getDeck(d.id).name).toBe('Original')
  })

  it('renameDeck counts code points and rejects control or format characters', () => {
    const lib = new Library(root)
    const e1 = lib.createEvent('E1')
    const d = lib.addDeck(e1.id, deckInput(1, 'Original'))
    // 120 astral characters are 240 UTF-16 units but 120 code points: accepted.
    const ok = '😀'.repeat(DECK_NAME_MAX)
    expect(lib.renameDeck(e1.id, d.id, ok).name).toBe(ok)
    expect(() => lib.renameDeck(e1.id, d.id, '😀'.repeat(DECK_NAME_MAX + 1))).toThrow(
      /120 characters/
    )
    for (const bad of ['a\u0000b', 'a\nb', 'a\tb', 'a‮b', 'a​b', 'a\u007Fb']) {
      expect(() => lib.renameDeck(e1.id, d.id, bad)).toThrow(/unsupported characters/)
    }
    expect(lib.getDeck(d.id).name).toBe(ok)
  })

  it('removeDeck rejects traversal and foreign ids, deleting nothing', () => {
    const lib = new Library(root)
    const e1 = lib.createEvent('E1')
    const e2 = lib.createEvent('E2')
    const d1 = lib.addDeck(e1.id, deckInput(1))
    expect(() => lib.removeDeck(e1.id, '..')).toThrow(/not valid|not found/)
    expect(() => lib.removeDeck(e2.id, d1.id)).toThrow(/not found/)
    expect(fs.existsSync(path.join(root, 'events.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'decks', d1.id, 'deck.json'))).toBe(true)
    expect(lib.getDecks(e1.id)).toHaveLength(1)
  })

  it('slidePath and lookups throw user-facing errors', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(1))
    expect(() => lib.slidePath(d.id, 5)).toThrow(/Slide not found\. /)
    expect(() => lib.slidePath('..', 0)).toThrow(/deck ID is not valid/)
    expect(() => lib.slidePath('00000000-0000-4000-8000-000000000000', 0)).toThrow(
      /Deck not found\. /
    )
    expect(() => lib.getDecks('nope')).toThrow(/Event not found\. /)
  })

  it('corrupt events.json gives a clear error', () => {
    fs.writeFileSync(path.join(root, 'events.json'), '{not json')
    expect(() => new Library(root)).toThrow(/events\.json is damaged/)
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
        'This KV format is not supported. Choose a PNG, JPG, or WebP image.'
      )
      expect(() => lib.setKv(ev.id, img('x.pdf'))).toThrow(/KV format is not supported/)
      expect(() => lib.setKv(ev.id, img('noext'))).toThrow(/KV format is not supported/)
    })

    it('refuses a missing file, a folder and a file over 50 MB; keeps the old KV', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const old = lib.setKv(ev.id, img('ok.png')).kv
      expect(() => lib.setKv(ev.id, path.join(src, 'missing.png'))).toThrow(/not found/)
      const dir = path.join(src, 'folder.png')
      fs.mkdirSync(dir)
      expect(() => lib.setKv(ev.id, dir)).toThrow(/not a file/)
      const big = path.join(src, 'big.png')
      fs.closeSync(fs.openSync(big, 'w'))
      fs.truncateSync(big, 50 * 1024 * 1024 + 1)
      expect(() => lib.setKv(ev.id, big)).toThrow(/50 MB/)
      expect(lib.listEvents()[0].kv).toBe(old)
      expect(fs.readdirSync(kvDir(ev.id))).toEqual([old])
    })

    it('refuses an unknown event', () => {
      const lib = new Library(root)
      expect(() => lib.setKv('nope', img('a.png'))).toThrow(/Event not found/)
      expect(() => lib.clearKv('nope')).toThrow(/Event not found/)
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

    /** events.json becomes a folder: the atomic rename in saveEvents then fails. */
    const breakSave = (): void => {
      fs.rmSync(path.join(root, 'events.json'), { force: true })
      fs.mkdirSync(path.join(root, 'events.json'))
    }
    const writeEvents = (events: unknown[]): void =>
      fs.writeFileSync(path.join(root, 'events.json'), JSON.stringify(events))

    it('setKv and clearKv never delete a previous file whose stored name is not a KV name', () => {
      const victim = path.join(root, 'kv', 'victim.txt')
      fs.mkdirSync(path.join(root, 'kv'), { recursive: true })
      fs.writeFileSync(victim, 'keep me')
      const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
      writeEvents([{ id, name: 'E', deckIds: [], kv: '../victim.txt' }])
      const lib = new Library(root)
      const r = lib.setKv(id, img('a.png'))
      expect(r.kv).toMatch(/^[0-9a-f-]{36}\.png$/)
      expect(fs.existsSync(victim)).toBe(true)
      writeEvents([{ id, name: 'E', deckIds: [], kv: '../victim.txt' }])
      const lib2 = new Library(root)
      expect('kv' in lib2.clearKv(id)).toBe(false)
      expect(fs.existsSync(victim)).toBe(true)
    })

    it('rejects UNC and network paths with advice', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      for (const p of [String.raw`\\server\share\a.png`, '//server/share/a.png']) {
        expect(() => lib.setKv(ev.id, p)).toThrow('Choose a KV image from a disk on this computer')
      }
      expect(fs.existsSync(kvDir(ev.id))).toBe(false)
    })

    it('rejects a symbolic link as the source', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const target = img('real.png')
      const link = path.join(src, 'link.png')
      try {
        fs.symlinkSync(target, link)
      } catch {
        return // no symlink privilege on this machine
      }
      expect(() => lib.setKv(ev.id, link)).toThrow(/shortcut or link/i)
      expect(fs.existsSync(kvDir(ev.id))).toBe(false)
    })

    it('a failed copy leaves no file behind and keeps the old KV', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const old = lib.setKv(ev.id, img('ok.png')).kv
      hooks.copy = (_s, dest) => {
        fs.writeFileSync(dest, 'partial')
        throw new Error('disk penuh')
      }
      try {
        expect(() => lib.setKv(ev.id, img('b.png'))).toThrow('disk penuh')
      } finally {
        hooks.copy = null
      }
      expect(fs.readdirSync(kvDir(ev.id))).toEqual([old])
      expect(lib.listEvents()[0].kv).toBe(old)
    })

    it('rejects and deletes a copy that turned out over 50 MB', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const old = lib.setKv(ev.id, img('ok.png')).kv
      hooks.copy = (_s, dest) => {
        fs.closeSync(fs.openSync(dest, 'w'))
        fs.truncateSync(dest, 50 * 1024 * 1024 + 1)
      }
      try {
        expect(() => lib.setKv(ev.id, img('b.png'))).toThrow(/50 MB/)
      } finally {
        hooks.copy = null
      }
      expect(fs.readdirSync(kvDir(ev.id))).toEqual([old])
      expect(lib.listEvents()[0].kv).toBe(old)
    })

    it('clearKv restores the KV in memory and rethrows when events.json cannot be saved', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const kv = lib.setKv(ev.id, img('a.png')).kv
      breakSave()
      expect(() => lib.clearKv(ev.id)).toThrow()
      expect(lib.listEvents()[0].kv).toBe(kv)
      expect(fs.existsSync(path.join(kvDir(ev.id), kv!))).toBe(true)
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
      expect(() => lib.kvFilePath('nope', kv)).toThrow(/Event not found/)
    })
  })
  describe('thumbnails', () => {
    const fakeThumb = (s: string, d: string): void =>
      fs.writeFileSync(d, `thumb-of-${fs.readFileSync(s, 'utf8')}`)
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

    it('addDeck generates a thumbnail per slide in the background', async () => {
      const lib = new Library(root, fakeThumb)
      const d = lib.addDeck(lib.createEvent('E').id, deckInput(3))
      await flush()
      for (const [i, f] of ['001.jpg', '002.jpg', '003.jpg'].entries()) {
        expect(fs.readFileSync(path.join(root, 'decks', d.id, 'thumbs', f), 'utf8')).toBe(
          `thumb-of-png-${i}`
        )
      }
    })

    it('creates a missing thumbnail lazily and caches it', async () => {
      let calls = 0
      const lib = new Library(root, (s, d) => {
        calls++
        fakeThumb(s, d)
      })
      const d = lib.addDeck(lib.createEvent('E').id, deckInput(1))
      await flush()
      fs.rmSync(path.join(root, 'decks', d.id, 'thumbs'), { recursive: true })
      const before = calls
      const [a, b] = await Promise.all([
        lib.thumbFilePath(d.id, '001.png'),
        lib.thumbFilePath(d.id, '001.png')
      ])
      expect(a).toBe(path.join(root, 'decks', d.id, 'thumbs', '001.jpg'))
      expect(b).toBe(a)
      await lib.thumbFilePath(d.id, '001.png')
      expect(calls - before).toBe(1)
    })

    it('falls back to the full slide when generation fails', async () => {
      const lib = new Library(root, () => {
        throw new Error('boom')
      })
      const d = lib.addDeck(lib.createEvent('E').id, deckInput(1))
      await flush()
      expect(await lib.thumbFilePath(d.id, '001.png')).toBe(
        path.join(root, 'decks', d.id, '001.png')
      )
    })

    it('rejects files that are not slides of the deck', async () => {
      const lib = new Library(root, fakeThumb)
      const d = lib.addDeck(lib.createEvent('E').id, deckInput(1))
      await expect(lib.thumbFilePath(d.id, '009.png')).rejects.toThrow(/not found/)
    })

    it('thumbnails follow the slide file through a reorder and go with the deck', async () => {
      const lib = new Library(root, fakeThumb)
      const ev = lib.createEvent('E')
      const d = lib.addDeck(ev.id, deckInput(2))
      await flush()
      lib.reorderSlides(d.id, [1, 0])
      const p = await lib.thumbFilePath(d.id, '002.png')
      expect(fs.readFileSync(p, 'utf8')).toBe('thumb-of-png-1')
      lib.removeDeck(ev.id, d.id)
      expect(fs.existsSync(path.join(root, 'decks', d.id))).toBe(false)
    })
  })

  describe('video slides', () => {
    it('stores a video next to its poster and only marks that slide', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const [p0, p1] = makePngs(2)
      const mp4 = path.join(src, 'clip.mp4')
      fs.writeFileSync(mp4, 'mp4-data')
      const deck = lib.addDeck(ev.id, {
        name: 'V',
        source: 'folder',
        width: 1920,
        height: 1080,
        slides: [
          { pngPath: p0, notes: '', videoPath: mp4 },
          { pngPath: p1, notes: '' }
        ]
      })
      const dir = path.join(root, 'decks', deck.id)
      expect(fs.readFileSync(path.join(dir, '001.mp4'), 'utf8')).toBe('mp4-data')
      expect(fs.existsSync(path.join(dir, '002.mp4'))).toBe(false)
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8'))
      expect(saved.slides[0].video).toBe('001.mp4')
      expect('video' in saved.slides[1]).toBe(false)
      expect(lib.videoFilePath(deck.id, '001.mp4')).toBe(path.join(dir, '001.mp4'))
      lib.removeDeck(ev.id, deck.id)
      expect(fs.existsSync(dir)).toBe(false)
    })

    it('videoFilePath refuses a file no slide uses', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const deck = lib.addDeck(ev.id, deckInput(1))
      expect(() => lib.videoFilePath(deck.id, '001.mp4')).toThrow(
        'Video not found. Choose a slide that exists in this deck.'
      )
    })
  })
})

describe('Library sections', () => {
  const setup = (n = 3) => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const decks = Array.from({ length: n }, (_, i) => lib.addDeck(ev.id, deckInput(1, `D${i}`)))
    return { lib, ev, decks }
  }
  const sectionsOf = (l: Library, id: string) => l.listEvents().find((e) => e.id === id)!.sections

  it('addSection persists, uses default names, and goes after same-at sections', () => {
    const { lib, ev, decks } = setup()
    const r1 = lib.addSection(ev.id, 1)
    const r2 = lib.addSection(ev.id, 1)
    expect(r1.event.sections?.[0]).toEqual({ id: r1.sectionId, name: 'Section 1', at: 1 })
    expect(r2.event.sections?.map((s) => s.name)).toEqual(['Section 1', 'Section 2'])
    expect(r2.event.sections?.map((s) => s.id)).toEqual([r1.sectionId, r2.sectionId])
    const lib2 = new Library(root)
    expect(sectionsOf(lib2, ev.id)).toHaveLength(2)
    expect(lib2.listEvents()[0].deckIds).toEqual(decks.map((d) => d.id))
  })

  it('addSection uses a given name and rejects invalid at', () => {
    const { lib, ev } = setup()
    expect(lib.addSection(ev.id, 0, ' Opening ').event.sections?.[0].name).toBe('Opening')
    const msg = 'The section position is not valid. Reload the app, then try again.'
    for (const at of [-1, 1.5, 4]) expect(() => lib.addSection(ev.id, at)).toThrow(msg)
  })

  it('renameSection persists and validates the name', () => {
    const { lib, ev } = setup()
    const { sectionId } = lib.addSection(ev.id, 0)
    expect(lib.renameSection(ev.id, sectionId, '  Part 2 ').sections?.[0].name).toBe('Part 2')
    expect(sectionsOf(new Library(root), ev.id)?.[0].name).toBe('Part 2')
    expect(() => lib.renameSection(ev.id, sectionId, '  ')).toThrow(
      'Section name is empty. Type a name, for example "Opening".'
    )
    expect(() => lib.renameSection(ev.id, sectionId, 5 as unknown as string)).toThrow(
      'Section name is empty'
    )
    expect(() => lib.renameSection(ev.id, sectionId, 'a\u0000b')).toThrow('Section name contains')
    expect(() => lib.renameSection(ev.id, sectionId, 'x'.repeat(DECK_NAME_MAX + 1))).toThrow(
      `Section name is too long. Use ${DECK_NAME_MAX} characters or fewer.`
    )
    expect(() => lib.renameSection(ev.id, 'nope', 'X')).toThrow(
      'Section not found. Reload the app, then try again.'
    )
    expect(() => lib.addSection(ev.id, 0, 'x'.repeat(DECK_NAME_MAX + 1))).toThrow('too long')
  })

  it('removeSection persists and reports a missing section', () => {
    const { lib, ev } = setup()
    const a = lib.addSection(ev.id, 0)
    const b = lib.addSection(ev.id, 2)
    expect(lib.removeSection(ev.id, a.sectionId).sections?.map((s) => s.id)).toEqual([b.sectionId])
    expect(sectionsOf(new Library(root), ev.id)?.map((s) => s.id)).toEqual([b.sectionId])
    expect(() => lib.removeSection(ev.id, a.sectionId)).toThrow(
      'Section not found. Reload the app, then try again.'
    )
    expect(() => lib.removeSection(ev.id, 7 as unknown as string)).toThrow('Section not found')
  })

  it('removeDeck shifts at only for sections after the deck', () => {
    const { lib, ev, decks } = setup()
    const s0 = lib.addSection(ev.id, 1).sectionId
    const s1 = lib.addSection(ev.id, 3).sectionId
    lib.removeDeck(ev.id, decks[1].id) // section at 1 is not after index 1; at 3 is
    const secs = sectionsOf(lib, ev.id)!
    expect(secs.find((s) => s.id === s0)?.at).toBe(1)
    expect(secs.find((s) => s.id === s1)?.at).toBe(2)
    lib.removeDeck(ev.id, decks[0].id) // both are after index 0
    expect(sectionsOf(lib, ev.id)!.map((s) => s.at)).toEqual([0, 1])
  })

  it('addDeck after an empty end section lands in that section', () => {
    const { lib, ev, decks } = setup(1)
    const { sectionId } = lib.addSection(ev.id, 1)
    const d = lib.addDeck(ev.id, deckInput(1, 'New'))
    const e = lib.listEvents()[0]
    expect(orderItems(e.deckIds, e.sections)).toEqual([
      { deck: decks[0].id },
      { section: sectionId },
      { deck: d.id }
    ])
  })

  it('reorder moves a deck across a section and persists', () => {
    const { lib, ev, decks } = setup(2)
    const { sectionId } = lib.addSection(ev.id, 1)
    lib.reorder(ev.id, [{ section: sectionId }, { deck: decks[1].id }, { deck: decks[0].id }])
    const e = new Library(root).listEvents()[0]
    expect(e.deckIds).toEqual([decks[1].id, decks[0].id])
    expect(e.sections?.[0].at).toBe(0)
  })

  it('reorder rejects invalid item sets and keeps the stored order', () => {
    const { lib, ev, decks } = setup(2)
    lib.addSection(ev.id, 1)
    const good = orderItems(
      decks.map((d) => d.id),
      lib.listEvents()[0].sections
    )
    const msg =
      'The deck list is not valid: it must include every deck and section in the event exactly once. Reload the app, then try again.'
    const [d0, s, d1] = good
    expect(() => lib.reorder(ev.id, [d0, s])).toThrow(msg) // missing deck
    expect(() => lib.reorder(ev.id, [...good, { deck: 'nope' }])).toThrow(msg) // extra id
    expect(() => lib.reorder(ev.id, [d0, s, s, d1])).toThrow(msg) // duplicate section
    expect(() => lib.reorder(ev.id, [d0, d1])).toThrow(msg) // missing section
    expect(() => lib.reorder(ev.id, [d0, { section: 'x' }, d1])).toThrow(msg) // unknown section
    const stored = JSON.stringify(lib.listEvents())
    const late = lib.addDeck(ev.id, deckInput(1, 'Late'))
    const afterLate = JSON.stringify(lib.listEvents())
    expect(() => lib.reorder(ev.id, good)).toThrow(msg) // deck imported after the order was built
    expect(JSON.stringify(lib.listEvents())).toBe(afterLate)
    expect(afterLate).not.toBe(stored)
    expect(lib.listEvents()[0].deckIds).toEqual([...decks.map((d) => d.id), late.id])
  })

  it('repairs damaged sections on load without losing decks', () => {
    const { ev, decks } = setup(2)
    const file = path.join(root, 'events.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    raw[0].sections = [
      null,
      { id: 1, name: 'x', at: 0 },
      { id: 'a', name: '  Keep  ', at: 99 },
      { id: 'a', name: 'dup', at: 0 },
      { id: 'b', name: '   ', at: 0 },
      { id: 'c', name: '', at: 0 },
      { id: 'd', name: 'Early', at: -5 }
    ]
    fs.writeFileSync(file, JSON.stringify(raw))
    const e = new Library(root).listEvents().find((x) => x.id === ev.id)!
    expect(e.deckIds).toEqual(decks.map((d) => d.id))
    expect(e.sections).toEqual([
      { id: 'd', name: 'Early', at: 0 },
      { id: 'a', name: 'Keep', at: 2 }
    ])
  })

  it('an event without sections lists as before', () => {
    const { lib, ev } = setup(1)
    const e = lib.listEvents().find((x) => x.id === ev.id)!
    expect('sections' in e).toBe(false)
    expect(new Library(root).listEvents()[0]).toEqual(e)
  })
})
