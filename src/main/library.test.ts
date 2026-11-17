import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { Library } from './library'
import { DECK_NAME_MAX, type DeckMeta, type EventMeta, type EventSummary } from '../shared/types'
import { orderItems } from '../shared/sections'
import { CANVAS_INVALID } from '../shared/canvas'

// fs namespace objects cannot be spied on in ESM; route copyFileSync through a hook.
const hooks = vi.hoisted(() => ({
  copy: null as null | ((src: string, dest: string) => void),
  rename: null as null | ((src: string, dest: string) => void)
}))
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>()
  const copyFileSync: typeof actual.copyFileSync = (s, d, m) =>
    hooks.copy ? hooks.copy(String(s), String(d)) : actual.copyFileSync(s, d, m)
  const renameSync: typeof actual.renameSync = (s, d) =>
    hooks.rename ? hooks.rename(String(s), String(d)) : actual.renameSync(s, d)
  return {
    ...actual,
    default: { ...actual, copyFileSync, renameSync },
    copyFileSync,
    renameSync
  }
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
  hooks.copy = null
  hooks.rename = null
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(src, { recursive: true, force: true })
})

describe('Library', () => {
  it('createEvent saves the canvas and outputs of the New event dialog', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('Gala', 1, {
      canvas: { width: 3841, height: 1080 },
      outputs: { hdmi: true, omt: false, ndi: true }
    })
    expect(ev.canvas).toEqual({ width: 3840, height: 1080 })
    expect(ev.outputs).toEqual({ hdmi: true, omt: false, ndi: true })
    // Kept across a restart; a plain event has neither field.
    const again = new Library(root)
    expect(again.listEvents()[0].outputs).toEqual({ hdmi: true, omt: false, ndi: true })
    const plain = again.createEvent('Plain', 2, { canvas: null, outputs: null })
    expect('canvas' in plain || 'outputs' in plain).toBe(false)
    expect(() => again.createEvent('Bad', 3, { canvas: { width: 10, height: 10 } })).toThrow(
      'Use a width and height'
    )
  })

  it('patchEventOutputs updates only an event that saved its outputs', () => {
    const lib = new Library(root)
    const own = lib.createEvent('Own', 1, { outputs: { hdmi: false, omt: false, ndi: false } })
    const plain = lib.createEvent('Plain', 2)
    expect(lib.patchEventOutputs(own.id, { omt: true })).toBe(true)
    expect(lib.patchEventOutputs(plain.id, { omt: true })).toBe(false)
    const events = new Library(root).listEvents()
    expect(events[0].outputs).toEqual({ hdmi: false, omt: true, ndi: false })
    expect(events[1].outputs).toBeUndefined()
  })

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

  it('records the owning event on the deck and finds no orphans in a healthy library', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput())
    expect(new Library(root).getDeck(d.id).eventId).toBe(ev.id)
    expect(lib.orphanDecks()).toEqual([])
  })

  it('finds a deck whose id was dropped from every event, and restores it to its event', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const other = lib.createEvent('Other')
    const d = lib.addDeck(ev.id, deckInput(2, 'slide'))
    // Simulate the lost write: events.json no longer lists the deck, the folder is still there.
    const file = path.join(root, 'events.json')
    const events = JSON.parse(fs.readFileSync(file, 'utf8')) as EventMeta[]
    for (const e of events) e.deckIds = []
    fs.writeFileSync(file, JSON.stringify(events))

    const lib2 = new Library(root)
    expect(lib2.getDecks(ev.id)).toEqual([])
    expect(lib2.orphanDecks()).toEqual([{ deckId: d.id, name: 'slide', eventId: ev.id }])
    expect(lib2.restoreDeck(d.id, ev.id)).toBe(true)
    // Back at the end of its event, and not offered twice.
    expect(new Library(root).getDecks(ev.id).map((x) => x.id)).toEqual([d.id])
    expect(new Library(root).orphanDecks()).toEqual([])
    // Its files were never touched.
    expect(fs.readFileSync(path.join(root, 'decks', d.id, '001.png'), 'utf8')).toBe('png-0')
    expect(other.deckIds).toEqual([])
  })

  it('never restores a deck into an event that no longer exists', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput())
    const file = path.join(root, 'events.json')
    fs.writeFileSync(file, JSON.stringify([]))

    const lib2 = new Library(root)
    expect(lib2.orphanDecks()).toEqual([{ deckId: d.id, name: 'Deck', eventId: null }])
    expect(lib2.restoreDeck(d.id, ev.id)).toBe(false)
    expect(new Library(root).orphanDecks()).toHaveLength(1)
  })

  it('ignores a folder that is not a readable deck', () => {
    const lib = new Library(root)
    lib.createEvent('E')
    // An empty uuid folder and a folder named with something that is not an id.
    fs.mkdirSync(path.join(root, 'decks', randomUUID()), { recursive: true })
    const odd = path.join(root, 'decks', 'not-a-uuid')
    fs.mkdirSync(odd, { recursive: true })
    fs.writeFileSync(path.join(odd, 'deck.json'), '{}')
    expect(lib.orphanDecks()).toEqual([])
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

  describe('web decks', () => {
    const fakeThumb = (s: string, d: string): void =>
      fs.writeFileSync(d, `thumb-of-${fs.readFileSync(s, 'utf8')}`)
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 50))
    const snapshot = (text: string): string => {
      const p = path.join(src, `snap-${randomUUID()}.png`)
      fs.writeFileSync(p, text)
      return p
    }
    const webInput = (
      url = 'https://www.canva.com/design/abc/view'
    ): Parameters<Library['addWebDeck']>[1] => ({
      name: 'Canva',
      url,
      snapshotPath: snapshot('snap-1'),
      width: 1920,
      height: 1080
    })

    it('addWebDeck stores one slide (the snapshot), source web and the URL', async () => {
      const lib = new Library(root, fakeThumb)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      expect(d).toMatchObject({
        name: 'Canva',
        source: 'web',
        width: 1920,
        height: 1080,
        web: { url: 'https://www.canva.com/design/abc/view' },
        slides: [{ file: '001.png', notes: '' }]
      })
      const dir = path.join(root, 'decks', d.id)
      expect(fs.readFileSync(path.join(dir, '001.png'), 'utf8')).toBe('snap-1')
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'deck.json'), 'utf8'))).toEqual(d)
      expect(lib.getDecks(ev.id)).toEqual([d])
      expect(lib.listEvents()[0].deckIds).toEqual([d.id])
      await flush()
      expect(fs.readFileSync(path.join(dir, 'thumbs', '001.jpg'), 'utf8')).toBe('thumb-of-snap-1')
    })

    it('addWebDeck refuses a URL that is not a web address', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      for (const bad of ['javascript:alert(1)', 'file:///C:/x.html', '']) {
        expect(() => lib.addWebDeck(ev.id, webInput(bad))).toThrow(
          'Enter a web address that starts with https://.'
        )
      }
      expect(lib.getDecks(ev.id)).toEqual([])
    })

    it('setWebUrl changes the URL of a web deck only', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      const next = lib.setWebUrl(ev.id, d.id, 'example.com/page')
      expect(next.web).toEqual({ url: 'https://example.com/page' })
      expect(lib.getDeck(d.id).web).toEqual({ url: 'https://example.com/page' })
      expect(() => lib.setWebUrl(ev.id, d.id, 'mailto:a@b.c')).toThrow(
        'Enter a web address that starts with https://.'
      )
      expect(lib.getDeck(d.id).web).toEqual({ url: 'https://example.com/page' })
      const pdf = lib.addDeck(ev.id, deckInput(1))
      expect(() => lib.setWebUrl(ev.id, pdf.id, 'https://example.com')).toThrow(/not a web page/)
      expect(() => lib.setWebUrl(lib.createEvent('F').id, d.id, 'https://x.com')).toThrow(
        /not found in this event/
      )
    })

    it('updateWebSnapshot replaces 001.png and its thumbnail', async () => {
      const lib = new Library(root, fakeThumb)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      await flush()
      lib.updateWebSnapshot(d.id, snapshot('snap-2'))
      const dir = path.join(root, 'decks', d.id)
      expect(fs.readFileSync(path.join(dir, '001.png'), 'utf8')).toBe('snap-2')
      const thumb = await lib.thumbFilePath(d.id, '001.png')
      expect(fs.readFileSync(thumb, 'utf8')).toBe('thumb-of-snap-2')
      expect(lib.getDeck(d.id).slides).toEqual([{ file: '001.png', notes: '' }])
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    })

    it('updateWebSnapshot right after a thumbnail request still makes a fresh thumbnail', async () => {
      const lib = new Library(root, fakeThumb)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      const first = lib.thumbFilePath(d.id, '001.png')
      lib.updateWebSnapshot(d.id, snapshot('snap-2'))
      const second = lib.thumbFilePath(d.id, '001.png')
      await first
      const thumb = await second
      expect(thumb).toBe(path.join(root, 'decks', d.id, 'thumbs', '001.jpg'))
      expect(fs.readFileSync(thumb, 'utf8')).toBe('thumb-of-snap-2')
    })

    it('updateWebSnapshot refuses a deck that is not a web deck', () => {
      const lib = new Library(root)
      const pdf = lib.addDeck(lib.createEvent('E').id, deckInput(1))
      expect(() => lib.updateWebSnapshot(pdf.id, snapshot('x'))).toThrow(/not a web page/)
      expect(fs.readFileSync(path.join(root, 'decks', pdf.id, '001.png'), 'utf8')).toBe('png-0')
    })

    it('keeps a valid page zoom and drops invalid ones on load', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      const file = path.join(root, 'decks', d.id, 'deck.json')
      fs.writeFileSync(file, JSON.stringify({ ...d, web: { url: d.web!.url, zoom: 1.5 } }))
      expect(lib.getDeck(d.id).web).toEqual({ url: d.web!.url, zoom: 1.5 })
      for (const bad of ['2', 0.33, null, -1]) {
        fs.writeFileSync(file, JSON.stringify({ ...d, web: { url: d.web!.url, zoom: bad } }))
        expect(lib.getDeck(d.id).web).toEqual({ url: d.web!.url })
      }
    })

    it('setWebZoom persists, removes the key at 1 and validates', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      lib.setWebZoom(ev.id, d.id, 1.25)
      expect(new Library(root).getDeck(d.id).web).toEqual({ url: d.web!.url, zoom: 1.25 })
      lib.setWebZoom(ev.id, d.id, 1)
      const raw = JSON.parse(fs.readFileSync(path.join(root, 'decks', d.id, 'deck.json'), 'utf8'))
      expect('zoom' in raw.web).toBe(false)
      expect(() => lib.setWebZoom(ev.id, d.id, 3)).toThrow('Choose a page zoom from the list.')
      const pdf = lib.addDeck(ev.id, deckInput(1))
      expect(() => lib.setWebZoom(ev.id, pdf.id, 1.25)).toThrow(/not a web page/)
    })

    it('a damaged web field is dropped when read', () => {
      const lib = new Library(root)
      const ev = lib.createEvent('E')
      const d = lib.addWebDeck(ev.id, webInput())
      const file = path.join(root, 'decks', d.id, 'deck.json')
      fs.writeFileSync(file, JSON.stringify({ ...d, web: { url: 42 } }))
      expect(lib.getDeck(d.id).web).toBeUndefined()
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
  const setup = (n = 3): { lib: Library; ev: EventMeta; decks: DeckMeta[] } => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const decks = Array.from({ length: n }, (_, i) => lib.addDeck(ev.id, deckInput(1, `D${i}`)))
    return { lib, ev, decks }
  }
  const sectionsOf = (l: Library, id: string): EventMeta['sections'] =>
    l.listEvents().find((e) => e.id === id)!.sections

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

  it("addSection 'end' appends after the last deck stored in main", () => {
    const { lib, ev, decks } = setup(2)
    const r = lib.addSection(ev.id, 'end')
    expect(r.event.sections?.[0]).toMatchObject({ id: r.sectionId, at: 2 })
    // A deck added meanwhile: 'end' follows it, a stale number would not.
    lib.addDeck(ev.id, deckInput(1, 'Late'))
    const r2 = lib.addSection(ev.id, 'end')
    expect(r2.event.sections?.map((s) => s.at)).toEqual([2, 3])
    expect(r2.event.deckIds).toHaveLength(decks.length + 1)
  })

  it('addSection uses a given name and rejects invalid at', () => {
    const { lib, ev } = setup()
    expect(lib.addSection(ev.id, 0, ' Opening ').event.sections?.[0].name).toBe('Opening')
    const msg = 'The section position is not valid. Reload the app, then try again.'
    for (const at of [-1, 1.5, 4]) expect(() => lib.addSection(ev.id, at)).toThrow(msg)
    expect(() => lib.addSection(ev.id, 'last' as never)).toThrow(msg)
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
    const msg = 'The deck list changed meanwhile. It has been reloaded; try the move again.'
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

describe('Library fit, deck audio and event canvas', () => {
  const setup = (): { lib: Library; ev: EventMeta; deck: DeckMeta } => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, deckInput(1))
    return { lib, ev, deck }
  }
  const NOT_IN_EVENT =
    'Deck not found in this event. Reload the deck list, then choose a deck from it.'

  it('setDeckFit persists and survives a reload', () => {
    const { lib, ev, deck } = setup()
    expect(lib.setDeckFit(ev.id, deck.id, 'fill').fit).toBe('fill')
    expect(new Library(root).getDecks(ev.id)[0].fit).toBe('fill')
  })

  it('setDeckFit rejects an unknown mode and a deck outside the event', () => {
    const { lib, ev, deck } = setup()
    expect(() => lib.setDeckFit(ev.id, deck.id, 'cover')).toThrow(
      'The display mode is not valid. Choose Fit, Fill or Stretch.'
    )
    expect(() => lib.setDeckFit(ev.id, randomUUID(), 'fill')).toThrow(NOT_IN_EVENT)
    expect(new Library(root).getDecks(ev.id)[0].fit).toBeUndefined()
  })

  it('setDeckAudio stores the sanitized value', () => {
    const { lib, ev, deck } = setup()
    expect(lib.setDeckAudio(ev.id, deck.id, { volume: 140, muted: true }).audio).toEqual({
      volume: 100,
      muted: true
    })
    expect(new Library(root).getDecks(ev.id)[0].audio).toEqual({ volume: 100, muted: true })
    expect(() => lib.setDeckAudio(ev.id, randomUUID(), {})).toThrow(NOT_IN_EVENT)
  })

  it('setEventCanvas stores a canvas, null removes it, invalid throws', () => {
    const { lib, ev } = setup()
    expect(lib.setEventCanvas(ev.id, { width: 3840, height: 1080 }).canvas).toEqual({
      width: 3840,
      height: 1080
    })
    expect(new Library(root).listEvents()[0].canvas).toEqual({ width: 3840, height: 1080 })
    expect(lib.setEventCanvas(ev.id, { width: 1921, height: 1081 }).canvas).toEqual({
      width: 1920,
      height: 1080
    })
    const cleared = lib.setEventCanvas(ev.id, null)
    expect('canvas' in cleared).toBe(false)
    expect('canvas' in new Library(root).listEvents()[0]).toBe(false)
    expect(() => lib.setEventCanvas(ev.id, { width: 10, height: 10 })).toThrow(CANVAS_INVALID)
    expect('canvas' in lib.listEvents()[0]).toBe(false)
  })

  it('listEvents returns a canvas copy that does not alias the stored one', () => {
    const { lib, ev } = setup()
    lib.setEventCanvas(ev.id, { width: 1280, height: 720 })
    lib.listEvents()[0].canvas!.width = 99
    expect(lib.listEvents()[0].canvas).toEqual({ width: 1280, height: 720 })
  })

  it('drops garbage fit, audio and canvas on load without throwing', () => {
    const { ev, deck } = setup()
    const deckFile = path.join(root, 'decks', deck.id, 'deck.json')
    fs.writeFileSync(deckFile, JSON.stringify({ ...deck, fit: 'zoom', audio: 'loud' }))
    const evFile = path.join(root, 'events.json')
    const raw = JSON.parse(fs.readFileSync(evFile, 'utf8'))
    raw[0].canvas = { width: 'a' }
    fs.writeFileSync(evFile, JSON.stringify(raw))
    const lib = new Library(root)
    const d = lib.getDecks(ev.id)[0]
    expect('fit' in d).toBe(false)
    expect('audio' in d).toBe(false)
    expect('canvas' in lib.listEvents()[0]).toBe(false)
  })

  it('sanitizes playback, clicks and hidden on load', () => {
    const { ev, deck } = setup()
    const deckFile = path.join(root, 'decks', deck.id, 'deck.json')
    const slide = (o: object): object => ({ file: '001.png', notes: '', ...o })
    fs.writeFileSync(
      deckFile,
      JSON.stringify({
        ...deck,
        playback: 'zoom',
        slides: [
          slide({ clicks: -2, hidden: 'yes' }),
          slide({ clicks: 1.5 }),
          slide({ clicks: 3, hidden: true })
        ]
      })
    )
    let d = new Library(root).getDecks(ev.id)[0]
    expect('playback' in d).toBe(false)
    expect(d.slides.map((s) => s.clicks)).toEqual([undefined, undefined, 3])
    expect(d.slides.map((s) => s.hidden)).toEqual([undefined, undefined, true])
    fs.writeFileSync(deckFile, JSON.stringify({ ...deck, source: 'pdf', playback: 'native' }))
    d = new Library(root).getDecks(ev.id)[0]
    expect('playback' in d).toBe(false)
    fs.writeFileSync(deckFile, JSON.stringify({ ...deck, playback: 'native' }))
    expect(new Library(root).getDecks(ev.id)[0].playback).toBe('native')
  })

  it('keeps a valid stored fit and sanitizes a stored audio object on load', () => {
    const { ev, deck } = setup()
    const deckFile = path.join(root, 'decks', deck.id, 'deck.json')
    fs.writeFileSync(
      deckFile,
      JSON.stringify({ ...deck, fit: 'stretch', audio: { volume: 500, muted: 'yes' } })
    )
    const d = new Library(root).getDecks(ev.id)[0]
    expect(d.fit).toBe('stretch')
    expect(d.audio).toEqual({ volume: 100, muted: false })
  })
})

describe('Library import files and playback', () => {
  const withFiles = (ext = 'pptx'): Parameters<Library['addDeck']>[1] => {
    const sourcePath = path.join(src, `deck.${ext}`)
    const pdfPath = path.join(src, 'deck.pdf')
    fs.writeFileSync(sourcePath, 'SRC')
    fs.writeFileSync(pdfPath, 'PDF')
    return {
      ...deckInput(2),
      sourcePath,
      pdfPath,
      playback: 'native',
      slides: deckInput(2).slides.map((s, i) => ({ ...s, clicks: i + 1, hidden: i === 1 }))
    }
  }

  it('addDeck copies original, source and source.pdf and stores metadata', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, withFiles())
    const dir = path.join(root, 'decks', deck.id)
    expect(fs.readFileSync(path.join(dir, 'original.pptx'), 'utf8')).toBe('SRC')
    expect(fs.readFileSync(path.join(dir, 'source.pptx'), 'utf8')).toBe('SRC')
    expect(fs.readFileSync(path.join(dir, 'source.pdf'), 'utf8')).toBe('PDF')
    expect(deck.playback).toBe('native')
    expect(deck.slides.map((s) => s.clicks)).toEqual([1, 2])
    expect(deck.slides.map((s) => s.hidden)).toEqual([undefined, true])
    expect(new Library(root).getDecks(ev.id)[0].playback).toBe('native')
  })

  it('sourceFilePath finds source.pptx or source.ppt and refuses a deck without one', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, withFiles())
    expect(lib.sourceFilePath(deck.id)).toBe(path.join(root, 'decks', deck.id, 'source.pptx'))
    const plain = lib.addDeck(ev.id, deckInput(1))
    expect(() => lib.sourceFilePath(plain.id)).toThrow(/Import the deck again/)
  })

  it('a pdf deck stores its PDF as original.pdf and source.pdf', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const pdf = path.join(src, 'a.pdf')
    fs.writeFileSync(pdf, 'PDF')
    const deck = lib.addDeck(ev.id, { ...deckInput(1), source: 'pdf', sourcePath: pdf })
    const dir = path.join(root, 'decks', deck.id)
    expect(fs.readFileSync(path.join(dir, 'original.pdf'), 'utf8')).toBe('PDF')
    expect(fs.readFileSync(path.join(dir, 'source.pdf'), 'utf8')).toBe('PDF')
  })

  it('a deck added without files has none of them', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, deckInput(1))
    expect(fs.existsSync(path.join(root, 'decks', deck.id, 'source.pdf'))).toBe(false)
    expect(deck.playback).toBeUndefined()
  })

  it('setPlayback persists and enforces the rules', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const pptx = lib.addDeck(ev.id, deckInput(1))
    const pdf = lib.addDeck(ev.id, { ...deckInput(1), source: 'pdf' })
    const BAD = 'The playback mode is not valid for this deck.'
    expect(lib.setPlayback(ev.id, pptx.id, 'native').playback).toBe('native')
    expect(new Library(root).getDecks(ev.id)[0].playback).toBe('native')
    expect(lib.setPlayback(ev.id, pdf.id, 'vector').playback).toBe('vector')
    expect(() => lib.setPlayback(ev.id, pdf.id, 'native')).toThrow(BAD)
    expect(() => lib.setPlayback(ev.id, pptx.id, 'bogus')).toThrow(BAD)
    expect(() => lib.setPlayback(ev.id, pptx.id, 3)).toThrow(BAD)
  })
})

describe('Library replaceDeckFiles, revertDeck and isEdited', () => {
  const imported = (
    over: Partial<Parameters<Library['replaceDeckFiles']>[1]> = {}
  ): Parameters<Library['replaceDeckFiles']>[1] => {
    const out = fs.mkdtempSync(path.join(src, 'imp-'))
    const pngs = ['A', 'B', 'C'].map((t, i) => {
      const p = path.join(out, `${i + 1}.png`)
      fs.writeFileSync(p, `new-${t}`)
      return p
    })
    const sourcePath = path.join(out, 'edit.pptx')
    const pdfPath = path.join(out, 'x.pdf')
    fs.writeFileSync(sourcePath, 'EDITED')
    fs.writeFileSync(pdfPath, 'NEWPDF')
    return {
      name: 'edit',
      width: 1280,
      height: 720,
      slides: [
        { pngPath: pngs[0], notes: 'n0', clicks: 2, hidden: false },
        { pngPath: pngs[1], notes: 'n1', clicks: 0, hidden: true },
        { pngPath: pngs[2], notes: 'n2', clicks: 1.5, hidden: false }
      ],
      pdfPath,
      isStatic: false,
      sourcePath,
      ...over
    }
  }

  const setup = (
    playback: DeckMeta['playback'] = 'native',
    isStatic?: boolean,
    removeFile?: (file: string) => void
  ): { lib: Library; deck: DeckMeta; dir: string; evId: string } => {
    const sourcePath = path.join(src, 'orig.pptx')
    const pdfPath = path.join(src, 'orig.pdf')
    fs.writeFileSync(sourcePath, 'ORIG')
    fs.writeFileSync(pdfPath, 'OLDPDF')
    const lib = new Library(
      root,
      () => {
        throw new Error('no thumbs in tests')
      },
      removeFile
    )
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, {
      ...deckInput(2, 'My deck'),
      sourcePath,
      pdfPath,
      playback,
      ...(isStatic === undefined ? {} : { isStatic })
    })
    return { lib, deck, dir: path.join(root, 'decks', deck.id), evId: ev.id }
  }

  it('replaces PNGs, notes, clicks, hidden, source and source.pdf and keeps name, fit and audio', () => {
    const { lib, deck, dir, evId } = setup('native')
    lib.setDeckFit(evId, deck.id, 'fill')
    lib.setDeckAudio(evId, deck.id, { volume: 40, muted: true })
    const next = lib.replaceDeckFiles(deck.id, imported())
    expect(next.name).toBe('My deck')
    expect(next.fit).toBe('fill')
    expect(next.audio).toEqual({ volume: 40, muted: true })
    expect(next.width).toBe(1280)
    expect(next.slides.map((s) => s.file)).toEqual(['001.png', '002.png', '003.png'])
    expect(next.slides.map((s) => s.notes)).toEqual(['n0', 'n1', 'n2'])
    // clicks and hidden are sanitized like readDeck does: only a whole number above 0, only true
    expect(next.slides.map((s) => s.clicks)).toEqual([2, undefined, undefined])
    expect(next.slides.map((s) => s.hidden)).toEqual([undefined, true, undefined])
    expect(fs.readFileSync(path.join(dir, '001.png'), 'utf8')).toBe('new-A')
    expect(fs.readFileSync(path.join(dir, '003.png'), 'utf8')).toBe('new-C')
    expect(fs.readFileSync(path.join(dir, 'source.pptx'), 'utf8')).toBe('EDITED')
    expect(fs.readFileSync(path.join(dir, 'source.pdf'), 'utf8')).toBe('NEWPDF')
    expect(new Library(root).getDeck(deck.id)).toEqual(next)
  })

  it('never touches original.* and leaves no staging folders', () => {
    const { lib, deck, dir } = setup()
    lib.replaceDeckFiles(deck.id, imported())
    expect(fs.readFileSync(path.join(dir, 'original.pptx'), 'utf8')).toBe('ORIG')
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([])
  })

  it('drops slides and thumbnails the new version no longer has', () => {
    const { lib, deck, dir } = setup()
    fs.mkdirSync(path.join(dir, 'thumbs'))
    fs.writeFileSync(path.join(dir, 'thumbs', '001.jpg'), 'oldthumb')
    const one = imported()
    one.slides = one.slides.slice(0, 1)
    lib.replaceDeckFiles(deck.id, one)
    expect(fs.existsSync(path.join(dir, '002.png'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'thumbs', '001.jpg'))).toBe(false)
  })

  it('playback: the import default vector becomes native when the deck is no longer static', () => {
    const vec = setup('vector', true)
    const next = vec.lib.replaceDeckFiles(vec.deck.id, imported({ isStatic: false }))
    expect(next.playback).toBe('native')
    expect(next.importStatic).toBe(false)
    const still = setup('vector', true)
    expect(still.lib.replaceDeckFiles(still.deck.id, imported({ isStatic: true })).playback).toBe(
      'vector'
    )
    const nat = setup('native', false)
    expect(nat.lib.replaceDeckFiles(nat.deck.id, imported({ isStatic: true })).playback).toBe(
      'native'
    )
    const img = setup('images', true)
    expect(img.lib.replaceDeckFiles(img.deck.id, imported({ isStatic: false })).playback).toBe(
      'images'
    )
  })

  it('playback: a vector mode the operator chose on an animated deck stays vector', () => {
    const { lib, deck, evId } = setup('native', false)
    expect(lib.setPlayback(evId, deck.id, 'vector').playback).toBe('vector')
    const next = lib.replaceDeckFiles(deck.id, imported({ isStatic: false }))
    expect(next.playback).toBe('vector')
    expect(new Library(root).getDeck(deck.id).playback).toBe('vector')
  })

  it('playback: an older deck without importStatic never switches', () => {
    const { lib, deck } = setup('vector')
    expect(deck.importStatic).toBeUndefined()
    const next = lib.replaceDeckFiles(deck.id, imported({ isStatic: false }))
    expect(next.playback).toBe('vector')
    // The re-import now records what it found.
    expect(next.importStatic).toBe(false)
  })

  it('importStatic is persisted, updated on every replace and sanitized on read', () => {
    const { lib, deck, dir } = setup('vector', true)
    expect(deck.importStatic).toBe(true)
    expect(new Library(root).getDeck(deck.id).importStatic).toBe(true)
    lib.replaceDeckFiles(deck.id, imported({ isStatic: true }))
    expect(lib.getDeck(deck.id).importStatic).toBe(true)
    lib.replaceDeckFiles(deck.id, imported({ isStatic: false }))
    expect(lib.getDeck(deck.id).importStatic).toBe(false)
    const file = path.join(dir, 'deck.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...raw, importStatic: 'yes' }))
    expect(new Library(root).getDeck(deck.id).importStatic).toBeUndefined()
  })

  it('a failing copy keeps every old file and the old deck.json', () => {
    const { lib, deck, dir } = setup()
    const before = lib.getDeck(deck.id)
    const inp = imported()
    hooks.copy = (s, d) => {
      if (d.endsWith('source.pdf')) throw new Error('disk full')
      fs.writeFileSync(d, fs.readFileSync(s))
    }
    expect(() => lib.replaceDeckFiles(deck.id, inp)).toThrow('disk full')
    hooks.copy = null
    expect(lib.getDeck(deck.id)).toEqual(before)
    expect(fs.readFileSync(path.join(dir, '001.png'), 'utf8')).toBe('png-0')
    expect(fs.readFileSync(path.join(dir, 'source.pptx'), 'utf8')).toBe('ORIG')
    expect(fs.readFileSync(path.join(dir, 'source.pdf'), 'utf8')).toBe('OLDPDF')
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([])
  })

  it('a failure while swapping rolls back to the old files', () => {
    const { lib, deck, dir } = setup()
    const before = lib.getDeck(deck.id)
    fs.mkdirSync(path.join(dir, 'thumbs'))
    fs.writeFileSync(path.join(dir, 'thumbs', '001.jpg'), 'oldthumb')
    const inp = imported()
    // The hook calls the mocked renameSync again, so route to the real one.
    hooks.rename = (s, d) => {
      if (d.endsWith('deck.json')) throw new Error('locked')
      const real = hooks.rename
      hooks.rename = null
      try {
        fs.renameSync(s, d)
      } finally {
        hooks.rename = real
      }
    }
    expect(() => lib.replaceDeckFiles(deck.id, inp)).toThrow('locked')
    hooks.rename = null
    expect(lib.getDeck(deck.id)).toEqual(before)
    expect(fs.readFileSync(path.join(dir, '001.png'), 'utf8')).toBe('png-0')
    expect(fs.existsSync(path.join(dir, '003.png'))).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'source.pptx'), 'utf8')).toBe('ORIG')
    expect(fs.readFileSync(path.join(dir, 'source.pdf'), 'utf8')).toBe('OLDPDF')
    expect(fs.readFileSync(path.join(dir, 'thumbs', '001.jpg'), 'utf8')).toBe('oldthumb')
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([])
  })

  it('refuses a deck that is not a PowerPoint deck and an empty slide list', () => {
    const { lib, deck } = setup()
    const pdf = lib.addDeck(lib.listEvents()[0].id, { ...deckInput(1), source: 'pdf' })
    expect(() => lib.replaceDeckFiles(pdf.id, imported())).toThrow(/PowerPoint deck/)
    expect(() => lib.replaceDeckFiles(deck.id, imported({ slides: [] }))).toThrow(/no slides/i)
  })

  it('isEdited is false until source differs from original; revertDeck gives the original to import', () => {
    const { lib, deck, dir } = setup()
    expect(lib.isEdited(deck.id)).toBe(false)
    expect(() => lib.revertDeck(deck.id)).toThrow(/not been edited/)
    lib.replaceDeckFiles(deck.id, imported())
    expect(lib.isEdited(deck.id)).toBe(true)
    const original = lib.revertDeck(deck.id)
    expect(original).toBe(path.join(dir, 'original.pptx'))
    // Reverting is complete once the original is installed as the new source.
    const back = imported()
    back.sourcePath = original
    lib.replaceDeckFiles(deck.id, back)
    expect(lib.isEdited(deck.id)).toBe(false)
    expect(fs.readFileSync(path.join(dir, 'source.pptx'), 'utf8')).toBe('ORIG')
    expect(fs.readFileSync(path.join(dir, 'original.pptx'), 'utf8')).toBe('ORIG')
  })

  it('isEdited is false for a deck without an imported file', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const d = lib.addDeck(ev.id, deckInput(1))
    expect(lib.isEdited(d.id)).toBe(false)
  })

  it('beginEdit copies source to edit, reuses unsaved changes and discardEdit removes it', () => {
    const { lib, deck, dir } = setup()
    const first = lib.beginEdit(deck.id)
    expect(first).toEqual({ file: path.join(dir, 'edit.pptx'), fresh: true })
    expect(fs.readFileSync(first.file, 'utf8')).toBe('ORIG')
    expect(lib.editChanged(deck.id)).toBe(false)
    fs.writeFileSync(first.file, 'MY WORK')
    expect(lib.editChanged(deck.id)).toBe(true)
    expect(lib.beginEdit(deck.id)).toEqual({ file: first.file, fresh: false })
    expect(fs.readFileSync(first.file, 'utf8')).toBe('MY WORK')
    lib.discardEdit(deck.id)
    expect(fs.existsSync(first.file)).toBe(false)
    expect(lib.editChanged(deck.id)).toBe(false)
  })

  describe('a working copy that cannot be deleted', () => {
    const lockedRemove =
      (state: { locked: boolean }) =>
      (file: string): void => {
        if (state.locked && /edit\.pptx?$/.test(file)) throw new Error('EBUSY')
        fs.rmSync(file, { force: true })
      }

    it('the next beginEdit overwrites the old edits from source', () => {
      const lockState = { locked: true }
      const { lib, deck, dir } = setup('native', false, lockedRemove(lockState))
      const first = lib.beginEdit(deck.id)
      fs.writeFileSync(first.file, 'REVERTED EDITS')
      lib.discardEdit(deck.id) // the window is still open: the delete fails
      expect(fs.readFileSync(first.file, 'utf8')).toBe('REVERTED EDITS')
      expect(fs.existsSync(path.join(dir, 'edit.stale'))).toBe(true)
      expect(lib.editChanged(deck.id)).toBe(false)
      const again = lib.beginEdit(deck.id)
      expect(again).toEqual({ file: first.file, fresh: true })
      expect(fs.readFileSync(first.file, 'utf8')).toBe('ORIG')
      expect(fs.existsSync(path.join(dir, 'edit.stale'))).toBe(false)
      // Cleared: unsaved work in this new copy is kept from now on.
      fs.writeFileSync(first.file, 'NEW WORK')
      expect(lib.beginEdit(deck.id)).toEqual({ file: first.file, fresh: false })
    })

    it('the marker survives a restart', () => {
      const lockState = { locked: true }
      const { lib, deck } = setup('native', false, lockedRemove(lockState))
      const first = lib.beginEdit(deck.id)
      fs.writeFileSync(first.file, 'REVERTED EDITS')
      lib.discardEdit(deck.id)
      const restarted = new Library(root)
      expect(restarted.beginEdit(deck.id).fresh).toBe(true)
      expect(fs.readFileSync(first.file, 'utf8')).toBe('ORIG')
    })

    it('a copy that is still locked gives a clear error and keeps the marker', () => {
      const lockState = { locked: true }
      const { lib, deck, dir } = setup('native', false, lockedRemove(lockState))
      const first = lib.beginEdit(deck.id)
      fs.writeFileSync(first.file, 'REVERTED EDITS')
      lib.discardEdit(deck.id)
      hooks.copy = (_s, d) => {
        if (d.endsWith('edit.pptx')) throw new Error('EBUSY')
      }
      expect(() => lib.beginEdit(deck.id)).toThrow(
        'Close the PowerPoint window that has the old edit open, then try again.'
      )
      hooks.copy = null
      expect(fs.existsSync(path.join(dir, 'edit.stale'))).toBe(true)
      expect(lib.beginEdit(deck.id).fresh).toBe(true)
    })

    it('a later successful delete clears the marker', () => {
      const lockState = { locked: true }
      const { lib, deck, dir } = setup('native', false, lockedRemove(lockState))
      const first = lib.beginEdit(deck.id)
      lib.discardEdit(deck.id)
      expect(fs.existsSync(path.join(dir, 'edit.stale'))).toBe(true)
      lockState.locked = false
      lib.discardEdit(deck.id)
      expect(fs.existsSync(first.file)).toBe(false)
      expect(fs.existsSync(path.join(dir, 'edit.stale'))).toBe(false)
      expect(lib.beginEdit(deck.id)).toEqual({ file: first.file, fresh: true })
    })

    it('removeDeck takes the marker with the deck folder', () => {
      const lockState = { locked: true }
      const { lib, deck, dir, evId } = setup('native', false, lockedRemove(lockState))
      lib.beginEdit(deck.id)
      lib.discardEdit(deck.id)
      lib.removeDeck(evId, deck.id)
      expect(fs.existsSync(dir)).toBe(false)
    })
  })

  it('setPlayback still answers a friendly error for a wrong mode', () => {
    const { lib, deck, evId } = setup()
    expect(() => lib.setPlayback(evId, deck.id, 'sideways')).toThrow(
      'The playback mode is not valid for this deck.'
    )
  })

  it('odp conversion: original.pptx stays, source.odp is the working copy, and it is not "edited" until it changes', () => {
    const orig = path.join(src, 'client.pptx')
    const odp = path.join(src, 'client.odp')
    fs.writeFileSync(orig, 'PPTX')
    fs.writeFileSync(odp, 'ODP')
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, {
      ...deckInput(1),
      sourcePath: odp,
      originalPath: orig,
      playback: 'native'
    })
    const dir = path.join(root, 'decks', deck.id)
    expect(fs.readFileSync(path.join(dir, 'original.pptx'), 'utf8')).toBe('PPTX')
    expect(fs.readFileSync(path.join(dir, 'source.odp'), 'utf8')).toBe('ODP')
    expect(lib.sourceFilePath(deck.id)).toBe(path.join(dir, 'source.odp'))
    expect(lib.isEdited(deck.id)).toBe(false)
    expect(() => lib.revertDeck(deck.id)).toThrow(/not been edited/)
    // an edit saved in the working copy
    fs.writeFileSync(path.join(dir, 'source.odp'), 'ODP EDITED')
    expect(lib.isEdited(deck.id)).toBe(true)
    expect(lib.revertDeck(deck.id)).toBe(path.join(dir, 'original.pptx'))
    expect(fs.readFileSync(path.join(dir, 'original.pptx'), 'utf8')).toBe('PPTX')
  })

  it('replaceDeckFiles with a fresh conversion (Revert) makes the deck unedited again', () => {
    const orig = path.join(src, 'client.pptx')
    const odp = path.join(src, 'client.odp')
    fs.writeFileSync(orig, 'PPTX')
    fs.writeFileSync(odp, 'ODP')
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, { ...deckInput(1), sourcePath: odp, originalPath: orig })
    const dir = path.join(root, 'decks', deck.id)
    // an edit is applied as a normal (non-converted) replacement of source.odp
    const edited = path.join(src, 'edit.odp')
    fs.writeFileSync(edited, 'ODP EDITED')
    const png = path.join(src, 'n.png')
    fs.writeFileSync(png, 'N')
    const base = {
      name: 'x',
      width: 10,
      height: 10,
      slides: [{ pngPath: png, notes: '', clicks: 0, hidden: false }],
      pdfPath: '',
      isStatic: false
    }
    lib.replaceDeckFiles(deck.id, { ...base, sourcePath: edited })
    expect(lib.isEdited(deck.id)).toBe(true)
    // Revert: the original is converted again; the new conversion is the pristine one
    const again = path.join(src, 'again.odp')
    fs.writeFileSync(again, 'ODP AGAIN')
    lib.replaceDeckFiles(deck.id, {
      ...base,
      sourcePath: again,
      originalPath: orig,
      converted: true
    })
    expect(fs.readFileSync(path.join(dir, 'source.odp'), 'utf8')).toBe('ODP AGAIN')
    expect(fs.readFileSync(path.join(dir, 'original.pptx'), 'utf8')).toBe('PPTX')
    expect(lib.isEdited(deck.id)).toBe(false)
  })

  it('keeping the PowerPoint format: no pristine marker, same rule as before', () => {
    const orig = path.join(src, 'client.pptx')
    fs.writeFileSync(orig, 'PPTX')
    const lib = new Library(root)
    const ev = lib.createEvent('E')
    const deck = lib.addDeck(ev.id, { ...deckInput(1), sourcePath: orig })
    expect(fs.existsSync(path.join(root, 'decks', deck.id, 'source.pristine'))).toBe(false)
    expect(lib.isEdited(deck.id)).toBe(false)
  })
})

describe('Library event fields and summaries', () => {
  const writeEvents = (events: unknown[]): void => {
    fs.mkdirSync(path.join(root, 'decks'), { recursive: true })
    fs.writeFileSync(path.join(root, 'events.json'), JSON.stringify(events))
  }
  const base = (extra: object = {}): object => ({
    id: randomUUID(),
    name: 'E',
    deckIds: [],
    ...extra
  })
  const noThumb = (s: string, d: string): void => fs.copyFileSync(s, d)

  it('loads an old events.json without the new fields', () => {
    writeEvents([base()])
    const [ev] = new Library(root).listEvents()
    expect(ev).not.toHaveProperty('createdAt')
    expect(ev).not.toHaveProperty('lastOpened')
    expect(ev).not.toHaveProperty('archived')
  })

  it('drops wrong types and keeps valid values', () => {
    writeEvents([
      base({ lastOpened: 'yesterday', createdAt: null, archived: 1 }),
      base({ archived: false }),
      base({ lastOpened: 1730000000000, archived: true })
    ])
    const [a, b, c] = new Library(root).listEvents()
    for (const ev of [a, b]) {
      expect(ev).not.toHaveProperty('createdAt')
      expect(ev).not.toHaveProperty('lastOpened')
      expect(ev).not.toHaveProperty('archived')
    }
    expect(c.lastOpened).toBe(1730000000000)
    expect(c.archived).toBe(true)
  })

  it('stamps createdAt and lastOpened, and touchEvent persists', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('A', 5)
    expect(ev.createdAt).toBe(5)
    expect(ev.lastOpened).toBe(5)
    expect(lib.touchEvent(ev.id, 9).lastOpened).toBe(9)
    expect(new Library(root).listEvents()[0].lastOpened).toBe(9)
  })

  it('setArchived sets and removes the key', () => {
    const lib = new Library(root)
    const ev = lib.createEvent('A')
    expect(lib.setArchived(ev.id, true).archived).toBe(true)
    lib.setArchived(ev.id, false)
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'))
    expect(raw[0]).not.toHaveProperty('archived')
  })

  it('touchEvent and setArchived throw on an unknown id', () => {
    const lib = new Library(root)
    expect(() => lib.touchEvent(randomUUID())).toThrow('Event not found')
    expect(() => lib.setArchived(randomUUID(), true)).toThrow('Event not found')
  })

  it('eventOfDeck finds the owner, else null', () => {
    const lib = new Library(root, noThumb)
    const ev = lib.createEvent('A')
    const deck = lib.addDeck(ev.id, deckInput(1))
    expect(lib.eventOfDeck(deck.id)).toBe(ev.id)
    expect(lib.eventOfDeck(randomUUID())).toBeNull()
    lib.removeDeck(ev.id, deck.id)
    expect(lib.eventOfDeck(deck.id)).toBeNull()
  })

  it('eventSummaries covers empty, pdf, web and missing-folder events', () => {
    const lib = new Library(root, noThumb)
    const empty = lib.createEvent('Empty')
    const pdf = lib.createEvent('Pdf')
    const d1 = lib.addDeck(pdf.id, { ...deckInput(2, 'P'), source: 'pdf' })
    const web = lib.createEvent('Web')
    const snap = path.join(src, 'snap.png')
    fs.writeFileSync(snap, 'snap')
    const w = lib.addWebDeck(web.id, {
      name: 'W',
      url: 'https://example.com/x',
      snapshotPath: snap,
      width: 1920,
      height: 1080
    })
    const broken = lib.createEvent('Broken')
    const d2 = lib.addDeck(broken.id, deckInput(1, 'Gone'))
    fs.rmSync(path.join(root, 'decks', d2.id), { recursive: true, force: true })

    const s: EventSummary[] = lib.eventSummaries()
    expect(s.map((x) => x.id)).toEqual([empty.id, pdf.id, web.id, broken.id])
    expect(s[0]).toMatchObject({ deckCount: 0, first: null, hasWeb: false })
    expect(s[1]).toMatchObject({ deckCount: 1, deckNames: ['P'], hasWeb: false })
    expect(s[1].first).toEqual({ deckId: d1.id, file: '001.png', web: false })
    expect(s[2].hasWeb).toBe(true)
    expect(s[2].first).toEqual({ deckId: w.id, file: '001.png', web: true })
    expect(s[3]).toMatchObject({ deckCount: 0, first: null })
  })
})
