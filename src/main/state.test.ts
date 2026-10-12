import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Library } from './library'
import { AppState } from './state'

let root: string
let src: string

function addDeck(lib: Library, eventId: string, n: number, name = 'Deck'): string {
  const slides = Array.from({ length: n }, (_, i) => {
    const p = path.join(src, `${name}-${i}.png`)
    fs.writeFileSync(p, `png-${i}`)
    return { pngPath: p, notes: `note-${i}` }
  })
  return lib.addDeck(eventId, { name, source: 'pdf', width: 1920, height: 1080, slides }).id
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-root-'))
  src = fs.mkdtempSync(path.join(os.tmpdir(), 'state-src-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(src, { recursive: true, force: true })
})

describe('AppState', () => {
  it('starts on the first event with the position on its first ready deck and nothing shown', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 3)
    const app = new AppState(lib)
    expect(app.eventId).toBe(a.id)
    expect(app.state).toMatchObject({ deckId: d, index: 0, shown: null })
  })

  it('goto on the live slide broadcasts because take changed', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 3)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d })
    const cb = vi.fn()
    app.onChange(cb)
    app.dispatch({ type: 'goto', index: 0 })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(app.state.take).toBe(2)
  })

  it('setEvent to another event does not change state.shown', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    const da = addDeck(lib, a.id, 3, 'a')
    const db = addDeck(lib, b.id, 2, 'b')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: da })
    app.dispatch({ type: 'next' })
    const shown = app.state.shown
    expect(shown).toEqual({ deckId: da, index: 1, file: '002.png' })

    const s = app.setEvent(b.id)
    expect(s.shown).toEqual(shown)
    expect(s).toMatchObject({ deckId: db, index: 0 })
    expect(app.eventId).toBe(b.id)
  })

  it('setEvent to an empty event keeps shown and clears the position', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    const da = addDeck(lib, a.id, 2)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: da })
    const s = app.setEvent(b.id)
    expect(s.shown).toEqual({ deckId: da, index: 0, file: '001.png' })
    expect(s.deckId).toBeNull()
  })

  it('remembers the position per event when switching back', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    const da = addDeck(lib, a.id, 4, 'a')
    addDeck(lib, b.id, 2, 'b')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: da })
    app.dispatch({ type: 'goto', index: 2 })
    app.setEvent(b.id)
    const s = app.setEvent(a.id)
    expect(s).toMatchObject({ deckId: da, index: 2 })
  })

  it('setEvent rejects an unknown event', () => {
    const lib = new Library(root)
    lib.createEvent('A')
    const app = new AppState(lib)
    expect(() => app.setEvent('nope')).toThrow()
  })

  it('dispatch next calls onChange once with the new state', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 3)
    const app = new AppState(lib)
    const cb = vi.fn()
    app.onChange(cb)
    const s = app.dispatch({ type: 'next' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(s)
    // From STANDBY the first Next takes the current slide live (no skip).
    expect(s).toMatchObject({ deckId: d, index: 0, shown: { deckId: d, index: 0 } })
    expect(app.state).toBe(s)
    const s2 = app.dispatch({ type: 'next' })
    expect(cb).toHaveBeenCalledTimes(2)
    expect(s2).toMatchObject({ deckId: d, index: 1, shown: { deckId: d, index: 1 } })
  })

  it('first Next after switching event takes slide 1 of the new event live', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    const da = addDeck(lib, a.id, 3, 'a')
    const db = addDeck(lib, b.id, 3, 'b')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: da })
    app.setEvent(b.id)
    const s = app.dispatch({ type: 'next' })
    expect(s.shown).toEqual({ deckId: db, index: 0, file: '001.png' })
  })

  it('does not call onChange when the state does not change', () => {
    const lib = new Library(root)
    lib.createEvent('A')
    const app = new AppState(lib)
    const cb = vi.fn()
    app.onChange(cb)
    app.dispatch({ type: 'next' })
    expect(cb).not.toHaveBeenCalled()
  })

  it('dispatch on an empty event does not throw', () => {
    const lib = new Library(root)
    lib.createEvent('A')
    const app = new AppState(lib)
    expect(() => app.dispatch({ type: 'next' })).not.toThrow()
    expect(() => app.dispatch({ type: 'prev' })).not.toThrow()
    expect(() => app.dispatch({ type: 'toggleBlack' })).not.toThrow()
    expect(app.state.black).toBe(true)
  })

  it('ignores an unknown action type (IPC input)', () => {
    const lib = new Library(root)
    lib.createEvent('A')
    const app = new AppState(lib)
    const before = app.state
    expect(app.dispatch({ type: 'bogus' } as unknown as Parameters<AppState['dispatch']>[0])).toBe(
      before
    )
  })

  it('dispatch with no events at all does not throw', () => {
    const lib = new Library(root)
    const app = new AppState(lib)
    expect(app.eventId).toBeNull()
    expect(() => app.dispatch({ type: 'next' })).not.toThrow()
  })

  it('refresh after a deck is added puts the position on it without showing it', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const app = new AppState(lib)
    const d = addDeck(lib, a.id, 2)
    const s = app.refresh()
    expect(s).toMatchObject({ deckId: d, index: 0, shown: null })
  })

  it('refresh clears shown when the shown deck was removed', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d1 = addDeck(lib, a.id, 2, 'one')
    const d2 = addDeck(lib, a.id, 2, 'two')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d1 })
    lib.removeDeck(a.id, d1)
    const s = app.refresh()
    expect(s.shown).toBeNull()
    expect(s.deckId).toBe(d2)
  })

  it('reorderSlides: the live slide stays on the output and the position follows it', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 3)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d })
    app.dispatch({ type: 'goto', index: 1 }) // 002.png live
    const cb = vi.fn()
    app.onChange(cb)
    // 002.png moves to the end: [001, 003, 002]
    const s = app.reorderSlides(d, [0, 2, 1])
    expect(s).toMatchObject({
      deckId: d,
      index: 2,
      shown: { deckId: d, index: 2, file: '002.png' }
    })
    expect(lib.slidePath(d, 2)).toBe(path.join(root, 'decks', d, '002.png'))
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('reorderSlides of other slides keeps shown on the same slide and index', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 3)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d })
    const before = app.state
    const s = app.reorderSlides(d, [0, 2, 1])
    expect(s).toBe(before)
  })

  it('reorderSlides of a shown deck from another event follows the slide too', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    const da = addDeck(lib, a.id, 3, 'a')
    addDeck(lib, b.id, 2, 'b')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: da })
    app.setEvent(b.id)
    const s = app.reorderSlides(da, [2, 1, 0])
    expect(s.shown).toEqual({ deckId: da, index: 2, file: '001.png' })
  })

  it('reorderSlides rejects an invalid order and changes nothing', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 3)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d })
    const before = app.state
    expect(() => app.reorderSlides(d, [0, 0, 1])).toThrow()
    expect(app.state).toBe(before)
  })

  it('reorder keeps position and shown', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d1 = addDeck(lib, a.id, 2, 'one')
    const d2 = addDeck(lib, a.id, 2, 'two')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d1 })
    app.dispatch({ type: 'next' })
    const before = app.state
    expect(app.reorder(a.id, [{ deck: d2 }, { deck: d1 }])).toBe(before)
    expect(lib.listEvents()[0].deckIds).toEqual([d2, d1])
  })

  it('removeDeck of the live deck makes the output black', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d1 = addDeck(lib, a.id, 2, 'one')
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d1 })
    const s = app.removeDeck(a.id, d1)
    expect(s).toMatchObject({ deckId: null, index: 0, shown: null })
  })

  describe('KV', () => {
    const img = (name: string): string => {
      const p = path.join(src, name)
      fs.writeFileSync(p, 'kv')
      return p
    }

    it('kvUrl follows the active event KV: start, setKv, clearKv', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const app = new AppState(lib)
      expect(app.state).toMatchObject({ kv: false, kvUrl: null })
      const seen: (string | null)[] = []
      app.onChange((s) => seen.push(s.kvUrl))
      const ev = app.setKv(a.id, img('a.png'))
      expect(app.state.kvUrl).toBe(`slide://kv/${a.id}/${ev.kv}`)
      expect(seen).toEqual([app.state.kvUrl])
      const ev2 = app.setKv(a.id, img('b.png'))
      expect(app.state.kvUrl).toBe(`slide://kv/${a.id}/${ev2.kv}`)
      expect(ev2.kv).not.toBe(ev.kv)
      app.clearKv(a.id)
      expect(app.state.kvUrl).toBeNull()
    })

    it('starts with the KV of the first event', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const kv = lib.setKv(a.id, img('a.png')).kv
      expect(new AppState(lib).state.kvUrl).toBe(`slide://kv/${a.id}/${kv}`)
    })

    it('setEvent applies the new event KV when the KV is not on air', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const kvA = lib.setKv(a.id, img('a.png')).kv
      const app = new AppState(lib)
      addDeck(lib, a.id, 2)
      app.refresh()
      app.dispatch({ type: 'next' }) // LIVE slide, KV not on air
      app.setEvent(b.id)
      expect(app.state.kvUrl).toBeNull()
      app.setEvent(a.id)
      expect(app.state.kvUrl).toBe(`slide://kv/${a.id}/${kvA}`)
    })

    it('setEvent keeps the KV image on air (forced or automatic at STANDBY)', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const kvA = lib.setKv(a.id, img('a.png')).kv
      const kvB = lib.setKv(b.id, img('b.png')).kv
      const urlA = `slide://kv/${a.id}/${kvA}`
      const app = new AppState(lib)
      app.setEvent(b.id) // STANDBY automatic KV of A stays until the operator acts
      expect(app.state.kvUrl).toBe(urlA)
      app.setEvent(a.id)
      app.dispatch({ type: 'toggleKv' }) // STANDBY: black
      expect(app.state).toMatchObject({ black: true, kv: false })
      app.setEvent(b.id) // not on air: B's own KV is applied
      expect(app.state.kvUrl).toBe(`slide://kv/${b.id}/${kvB}`)
      app.dispatch({ type: 'toggleKv' })
      expect(app.state).toMatchObject({ kv: true, black: false })
      app.setEvent(a.id)
      expect(app.state).toMatchObject({ kv: true, kvUrl: `slide://kv/${b.id}/${kvB}` })
    })

    it('dispatch off the KV applies the active event KV', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      lib.setKv(a.id, img('a.png'))
      const kvB = lib.setKv(b.id, img('b.png')).kv
      addDeck(lib, a.id, 2)
      const app = new AppState(lib)
      app.dispatch({ type: 'next' })
      app.dispatch({ type: 'toggleKv' }) // forced KV of A
      app.setEvent(b.id)
      const urlA = app.state.kvUrl
      expect(urlA).toContain(a.id)
      app.dispatch({ type: 'toggleKv' }) // off: back to the slide, B's KV applied
      expect(app.state).toMatchObject({ kv: false, kvUrl: `slide://kv/${b.id}/${kvB}` })
    })

    it('setKv/clearKv on another event leave the KV on air alone', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const kvA = lib.setKv(a.id, img('a.png')).kv
      const urlA = `slide://kv/${a.id}/${kvA}`
      const app = new AppState(lib)
      app.setEvent(b.id) // automatic KV of A on air
      app.setKv(b.id, img('b.png'))
      expect(app.state.kvUrl).toBe(urlA)
      app.clearKv(b.id)
      expect(app.state.kvUrl).toBe(urlA)
      app.setKv(a.id, img('a2.png')) // replaces the KV on air
      expect(app.state.kvUrl).not.toBe(urlA)
      expect(app.state.kvUrl).toContain(a.id)
    })

    it('clearKv of the KV on air at STANDBY turns it off and goes black', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      lib.setKv(a.id, img('a.png'))
      const kvB = lib.setKv(b.id, img('b.png')).kv
      const app = new AppState(lib)
      app.setEvent(b.id)
      app.clearKv(a.id) // the image on air belongs to A
      expect(app.state).toMatchObject({
        kv: false,
        black: true,
        kvUrl: `slide://kv/${b.id}/${kvB}`
      })
    })

    it('clearKv of the active KV at STANDBY goes black; with a slide LIVE it just turns off', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      lib.setKv(a.id, img('a.png'))
      addDeck(lib, a.id, 2)
      const app = new AppState(lib)
      app.clearKv(a.id)
      expect(app.state).toMatchObject({ kv: false, black: true, kvUrl: null })
      app.dispatch({ type: 'toggleBlack' })
      app.setKv(a.id, img('b.png'))
      app.dispatch({ type: 'next' })
      app.dispatch({ type: 'toggleKv' })
      expect(app.state.kv).toBe(true)
      app.clearKv(a.id)
      expect(app.state).toMatchObject({ kv: false, black: false, kvUrl: null })
    })

    it('setKv on another event does not touch the active kvUrl', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const app = new AppState(lib)
      app.setKv(b.id, img('b.png'))
      expect(app.eventId).toBe(a.id)
      expect(app.state.kvUrl).toBeNull()
    })

    it('clearKv turns kv off; KV on and Black are exclusive', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const app = new AppState(lib)
      app.dispatch({ type: 'toggleKv' })
      expect(app.state.kv).toBe(false) // no KV: no-op
      app.setKv(a.id, img('a.png'))
      app.dispatch({ type: 'toggleKv' }) // STANDBY shows the KV by itself: K goes black
      expect(app.state).toMatchObject({ kv: false, black: true })
      app.dispatch({ type: 'toggleKv' })
      expect(app.state).toMatchObject({ kv: true, black: false })
      app.dispatch({ type: 'toggleBlack' })
      expect(app.state).toMatchObject({ kv: false, black: true })
      app.dispatch({ type: 'toggleKv' })
      expect(app.state).toMatchObject({ kv: true, black: false })
      app.clearKv(a.id)
      expect(app.state).toMatchObject({ kv: false, kvUrl: null })
    })

    it('a refused image changes nothing', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const app = new AppState(lib)
      expect(() => app.setKv(a.id, img('a.gif'))).toThrow(/KV format/)
      expect(app.state.kvUrl).toBeNull()
    })
  })
})

describe('AppState sections', () => {
  it('nextSection uses the active event sections', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d1 = addDeck(lib, a.id, 1, 'one')
    const d2 = addDeck(lib, a.id, 1, 'two')
    lib.addSection(a.id, 1)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d1 })
    expect(app.sections()).toHaveLength(1)
    const s = app.dispatch({ type: 'nextSection' })
    expect(s.deckId).toBe(d2)
    expect(s.shown?.deckId).toBe(d2)
  })

  it('nextSection from STANDBY after setEvent takes the first section, not the second', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d1 = addDeck(lib, a.id, 1, 'one')
    addDeck(lib, a.id, 1, 'two')
    lib.addSection(a.id, 0)
    lib.addSection(a.id, 1)
    const app = new AppState(lib)
    app.setEvent(a.id)
    expect(app.state).toMatchObject({ deckId: d1, index: 0, shown: null })
    const s = app.dispatch({ type: 'nextSection' })
    expect(s.shown).toMatchObject({ deckId: d1, index: 0 })
    expect(s.deckId).toBe(d1)
  })

  it('nextSection is a no-op after setEvent to an event without sections', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    addDeck(lib, a.id, 1, 'a1')
    addDeck(lib, a.id, 1, 'a2')
    lib.addSection(a.id, 1)
    const b1 = addDeck(lib, b.id, 1, 'b1')
    addDeck(lib, b.id, 1, 'b2')
    const app = new AppState(lib)
    app.setEvent(b.id)
    expect(app.sections()).toEqual([])
    app.dispatch({ type: 'selectDeck', deckId: b1 })
    const before = app.state
    expect(app.dispatch({ type: 'nextSection' })).toBe(before)
  })

  it('reorder moves the live last slide into and out of a section end for auto advance', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d1 = addDeck(lib, a.id, 1, 'one')
    const d2 = addDeck(lib, a.id, 1, 'two')
    const d3 = addDeck(lib, a.id, 1, 'three')
    const { sectionId } = lib.addSection(a.id, 1)
    const app = new AppState(lib, true)
    app.dispatch({ type: 'selectDeck', deckId: d1 })
    const before = app.state
    expect(app.dispatch({ type: 'next' })).toBe(before) // d1 alone in the lead block
    app.reorder(a.id, [{ deck: d2 }, { section: sectionId }, { deck: d1 }, { deck: d3 }])
    expect(app.dispatch({ type: 'next' }).deckId).toBe(d3)
    app.dispatch({ type: 'selectDeck', deckId: d1 })
    app.reorder(a.id, [{ deck: d2 }, { section: sectionId }, { deck: d3 }, { deck: d1 }])
    const end = app.state
    expect(app.dispatch({ type: 'next' })).toBe(end)
  })
})
