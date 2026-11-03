import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Library } from './library'
import { AppState } from './state'
import { kvOnAir } from '../shared/program'

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
    expect(shown).toMatchObject({ deckId: da, index: 1, file: '002.png' })

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
    expect(s.shown).toMatchObject({ deckId: da, index: 0, file: '001.png' })
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
    expect(s.shown).toMatchObject({ deckId: db, index: 0, file: '001.png' })
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
    expect(s.shown).toMatchObject({ deckId: da, index: 2, file: '001.png' })
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

  describe('canvas, fit and deck audio', () => {
    it('a fresh state has the default canvas', () => {
      const lib = new Library(root)
      lib.createEvent('A')
      const app = new AppState(lib)
      expect(app.state.canvas).toEqual({ width: 1920, height: 1080, origin: 'default' })
    })

    it('an event canvas override is the canvas while that event owns the output', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      lib.setEventCanvas(b.id, { width: 3840, height: 1080 })
      const app = new AppState(lib)
      const db = addDeck(lib, b.id, 2, 'b')
      expect(app.state.canvas.origin).toBe('default')
      // Selecting B alone does not touch the output.
      expect(app.setEvent(b.id).canvas).toEqual({ width: 1920, height: 1080, origin: 'default' })
      expect(app.dispatch({ type: 'selectDeck', deckId: db }).canvas).toEqual({
        width: 3840,
        height: 1080,
        origin: 'event'
      })
      expect(app.setEvent(a.id).canvas.origin).toBe('event')
    })

    it('switching to an event without override keeps the canvas of the event on air', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      lib.setEventCanvas(a.id, { width: 3840, height: 1080 })
      const da = addDeck(lib, a.id, 2, 'a')
      const app = new AppState(lib)
      expect(app.state.canvas.origin).toBe('event')
      app.dispatch({ type: 'selectDeck', deckId: da })
      expect(app.state.canvas.origin).toBe('event')
      const s = app.setEvent(b.id)
      expect(s.shown?.deckId).toBe(da)
      expect(s.canvas).toEqual({ width: 3840, height: 1080, origin: 'event' })
    })

    it('a changed machine canvas plus refresh emits a new state', () => {
      const lib = new Library(root)
      lib.createEvent('A')
      let machine = { width: 1920, height: 1080 }
      const app = new AppState(lib, false, () => machine)
      const cb = vi.fn()
      app.onChange(cb)
      app.refresh()
      expect(cb).not.toHaveBeenCalled()
      machine = { width: 1280, height: 720 }
      app.refresh()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(app.state.canvas).toEqual({ width: 1280, height: 720, origin: 'default' })
    })

    it('a dispatch after the machine canvas changed carries the new canvas', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const d = addDeck(lib, a.id, 2)
      let machine = { width: 1920, height: 1080 }
      const app = new AppState(lib, false, () => machine)
      machine = { width: 1280, height: 720 }
      app.dispatch({ type: 'selectDeck', deckId: d })
      expect(app.state.canvas.width).toBe(1280)
    })

    it('setDeckAudio on the live deck plus refresh emits the new audio with the same take', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const d = addDeck(lib, a.id, 2)
      const app = new AppState(lib)
      app.dispatch({ type: 'selectDeck', deckId: d })
      const take = app.state.take
      const cb = vi.fn()
      app.onChange(cb)
      lib.setDeckAudio(a.id, d, { volume: 30, muted: true })
      app.refresh()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(app.state.shown?.audio).toEqual({ volume: 30, muted: true })
      expect(app.state.take).toBe(take)
    })

    it('setDeckFit on the live deck plus refresh emits the new fit with the same take; a second refresh is silent', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const d = addDeck(lib, a.id, 2)
      const app = new AppState(lib)
      app.dispatch({ type: 'selectDeck', deckId: d })
      const take = app.state.take
      const cb = vi.fn()
      app.onChange(cb)
      lib.setDeckFit(a.id, d, 'fill')
      app.refresh()
      expect(app.state.shown?.fit).toBe('fill')
      expect(app.state.take).toBe(take)
      app.refresh()
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })
})

describe('AppState web decks', () => {
  function addWeb(lib: Library, eventId: string, name = 'Web'): string {
    const p = path.join(src, `${name}-snap.png`)
    fs.writeFileSync(p, 'snap')
    return lib.addWebDeck(eventId, {
      name,
      url: 'https://example.com/',
      snapshotPath: p,
      width: 1920,
      height: 1080
    }).id
  }

  it('Next on a live web deck forwards ArrowRight once and keeps the same state', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    addDeck(lib, a.id, 2)
    const forward = vi.fn()
    const app = new AppState(lib, false, undefined, () => true, forward)
    app.dispatch({ type: 'selectDeck', deckId: w })
    expect(app.state.shown).toMatchObject({ deckId: w, web: { deckId: w } })
    const before = app.state
    const cb = vi.fn()
    app.onChange(cb)
    expect(app.dispatch({ type: 'next' })).toBe(before)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledWith(w, 'ArrowRight')
    expect(app.dispatch({ type: 'prev' })).toBe(before)
    expect(forward).toHaveBeenLastCalledWith(w, 'ArrowLeft')
    expect(forward).toHaveBeenCalledTimes(2)
    expect(cb).not.toHaveBeenCalled()
  })

  it('with Interact on, Next and Prev send no key and never move the position', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    addDeck(lib, a.id, 2)
    const forward = vi.fn()
    let interact = false
    const app = new AppState(
      lib,
      false,
      undefined,
      () => true,
      forward,
      () => true,
      (deckId) => interact && deckId === w
    )
    app.dispatch({ type: 'selectDeck', deckId: w })
    const before = app.state
    const cb = vi.fn()
    app.onChange(cb)
    interact = true
    expect(app.dispatch({ type: 'next' })).toBe(before)
    expect(app.dispatch({ type: 'prev' })).toBe(before)
    expect(forward).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalled()
    // Interact off again: the arrows reach the page as before.
    interact = false
    expect(app.dispatch({ type: 'next' })).toBe(before)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(forward).toHaveBeenCalledWith(w, 'ArrowRight')
  })

  it('Next on a frozen web deck does not forward a key', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    const forward = vi.fn()
    const app = new AppState(lib, false, undefined, () => true, forward)
    app.dispatch({ type: 'selectDeck', deckId: w })
    app.dispatch({ type: 'toggleFreeze' })
    app.dispatch({ type: 'next' })
    expect(forward).not.toHaveBeenCalled()
  })

  it('taking a web deck that is not ready is refused; once ready it goes live', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 2)
    const w = addWeb(lib, a.id)
    let ready = false
    const app = new AppState(lib, false, undefined, (id) => id === w && ready)
    app.dispatch({ type: 'selectDeck', deckId: d })
    const before = app.state
    expect(app.dispatch({ type: 'selectDeck', deckId: w })).toBe(before)
    expect(app.dispatch({ type: 'nextDeck' })).toBe(before)
    expect(app.state.shown?.deckId).toBe(d)
    ready = true
    expect(app.dispatch({ type: 'nextDeck' }).shown).toMatchObject({ deckId: w })
  })

  it('a frozen preview move onto a not-ready web deck is allowed (nothing goes on air)', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 2)
    const w = addWeb(lib, a.id)
    const app = new AppState(lib, false, undefined, () => false)
    app.dispatch({ type: 'selectDeck', deckId: d })
    app.dispatch({ type: 'toggleFreeze' })
    const s = app.dispatch({ type: 'selectDeck', deckId: w })
    expect(s.deckId).toBe(w)
    expect(s.shown?.deckId).toBe(d)
  })

  it('setWebHold(true) on a live web deck, then toggleKv clears it', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    const kv = path.join(src, 'kv.png')
    fs.writeFileSync(kv, 'kv')
    lib.setKv(a.id, kv)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: w })
    const cb = vi.fn()
    app.onChange(cb)
    expect(app.setWebHold(true).webHold).toBe(true)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(app.dispatch({ type: 'toggleKv' }).webHold).toBe(false)
  })

  it('setWebHold(true) without a web deck on air does nothing', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const d = addDeck(lib, a.id, 2)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: d })
    const before = app.state
    expect(app.setWebHold(true)).toBe(before)
  })

  it('resumeWeb is refused while the live page is not ready', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    let ready = true
    const app = new AppState(lib, false, undefined, () => ready)
    app.dispatch({ type: 'selectDeck', deckId: w })
    app.setWebHold(true)
    ready = false
    expect(app.dispatch({ type: 'resumeWeb' }).webHold).toBe(true)
    ready = true
    expect(app.dispatch({ type: 'resumeWeb' }).webHold).toBe(false)
  })

  it('K or B off after HOLD is refused while the page is not ready (no failed page on air)', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    const kv = path.join(src, 'kv.png')
    fs.writeFileSync(kv, 'kv')
    lib.setKv(a.id, kv)
    let ready = true
    const app = new AppState(lib, false, undefined, () => ready)
    app.dispatch({ type: 'selectDeck', deckId: w })
    app.setWebHold(true)
    ready = false
    // K on: leaves the page, clears the hold.
    let s = app.dispatch({ type: 'toggleKv' })
    expect(s.kv).toBe(true)
    expect(s.webHold).toBe(false)
    // K off would show the failed page: refused.
    expect(app.dispatch({ type: 'toggleKv' })).toBe(s)
    // B on from KV is fine (nothing of the page shows), B off would show the page: refused.
    s = app.dispatch({ type: 'toggleBlack' })
    expect(s.black).toBe(true)
    expect(app.dispatch({ type: 'toggleBlack' })).toBe(s)
    // Once the page is ready again, B off shows it.
    ready = true
    s = app.dispatch({ type: 'toggleBlack' })
    expect(s.black).toBe(false)
    expect(s.shown?.web?.deckId).toBe(w)
  })

  it('B off after HOLD without a KV is refused while the page is not ready', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    let ready = true
    const app = new AppState(lib, false, undefined, () => ready)
    app.dispatch({ type: 'selectDeck', deckId: w })
    app.setWebHold(true)
    ready = false
    const s = app.dispatch({ type: 'toggleBlack' })
    expect(s.black).toBe(true)
    expect(s.webHold).toBe(false)
    expect(app.dispatch({ type: 'toggleBlack' })).toBe(s)
    // K with no KV image does nothing visible; the page stays off air.
    expect(app.dispatch({ type: 'toggleKv' }).black).toBe(true)
  })

  it('removing the live web deck drops shown and the hold', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const w = addWeb(lib, a.id)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: w })
    app.setWebHold(true)
    const s = app.removeDeck(a.id, w)
    expect(s.shown).toBeNull()
    expect(s.webHold).toBe(false)
  })

  it('switching events keeps the live web deck on air', () => {
    const lib = new Library(root)
    const a = lib.createEvent('A')
    const b = lib.createEvent('B')
    const w = addWeb(lib, a.id)
    addDeck(lib, b.id, 1)
    const app = new AppState(lib)
    app.dispatch({ type: 'selectDeck', deckId: w })
    const s = app.setEvent(b.id)
    expect(s.shown).toMatchObject({ deckId: w, web: { deckId: w } })
  })

  describe('native engine gate', () => {
    function addNative(lib: Library, eventId: string): string {
      const slides = [2, 0].map((clicks, i) => {
        const p = path.join(src, `nat-${i}.png`)
        fs.writeFileSync(p, `png-${i}`)
        return { pngPath: p, notes: '', clicks }
      })
      return lib.addDeck(eventId, {
        name: 'Nat',
        source: 'pptx',
        width: 1920,
        height: 1080,
        slides,
        playback: 'native'
      }).id
    }

    it('takes a native deck natively when the engine is ready and steps without a take', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const d = addNative(lib, a.id)
      const app = new AppState(lib, false, undefined, undefined, undefined, () => true)
      const s = app.dispatch({ type: 'selectDeck', deckId: d })
      expect(s.shown).toMatchObject({ playback: 'native', step: 0 })
      const s2 = app.dispatch({ type: 'next' })
      expect(s2.shown?.step).toBe(1)
      expect(s2.take).toBe(s.take)
    })

    it('falls back to images for a take while the engine is not ready', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const d = addNative(lib, a.id)
      const app = new AppState(lib, false, undefined, undefined, undefined, () => false)
      const s = app.dispatch({ type: 'selectDeck', deckId: d })
      expect(s.shown).toMatchObject({ playback: 'images', step: 0 })
      expect(app.dispatch({ type: 'next' }).index).toBe(1)
    })

    it('resumeNative is refused while the engine is not ready', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const d = addNative(lib, a.id)
      let ready = true
      const app = new AppState(lib, false, undefined, undefined, undefined, () => ready)
      app.dispatch({ type: 'selectDeck', deckId: d })
      app.dispatch({ type: 'nativeFallback', deckId: d })
      ready = false
      expect(app.dispatch({ type: 'resumeNative', deckId: d }).shown?.playback).toBe('images')
      ready = true
      expect(app.dispatch({ type: 'resumeNative', deckId: d }).shown?.playback).toBe('native')
    })
  })

  describe('air event', () => {
    const img = (n: string): string => {
      const p = path.join(src, n)
      fs.writeFileSync(p, 'kv')
      return p
    }
    const c720 = { width: 1280, height: 720 }

    it('switching events keeps the output canvas and shown; a take moves the air', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      addDeck(lib, a.id, 2, 'a')
      addDeck(lib, b.id, 2, 'b')
      lib.setEventCanvas(b.id, c720)
      const app = new AppState(lib)
      app.dispatch({ type: 'next' })
      const before = app.state
      const s = app.setEvent(b.id)
      expect(s.airEvent).toBe(a.id)
      expect(s.shown).toEqual(before.shown)
      expect(s.canvas).toEqual(before.canvas)
      const t = app.dispatch({ type: 'next' })
      expect(t.airEvent).toBe(b.id)
      expect(t.canvas).toMatchObject(c720)
    })

    it('STANDBY: selecting an event with a KV does not put it on air', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      lib.setKv(b.id, img('b.png'))
      const app = new AppState(lib)
      app.setEvent(b.id)
      expect(kvOnAir(app.state)).toBe(false)
      app.dispatch({ type: 'setTransition', transition: 'fade' })
      expect(kvOnAir(app.state)).toBe(false)
      expect(app.state.airEvent).toBe(a.id)
    })

    it('STANDBY KV of A stays on air when B (no KV) is selected', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const kvA = lib.setKv(a.id, img('a.png')).kv
      const app = new AppState(lib)
      app.setEvent(b.id)
      expect(kvOnAir(app.state)).toBe(true)
      expect(app.state.kvUrl).toBe(`slide://kv/${a.id}/${kvA}`)
    })

    it('Black at STANDBY stays black and keeps the air event', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const app = new AppState(lib)
      app.dispatch({ type: 'toggleBlack' })
      app.setEvent(b.id)
      expect(app.state).toMatchObject({ black: true, airEvent: a.id })
    })

    it('K in B while A is live puts B on air; K off returns to A', () => {
      const lib = new Library(root)
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      lib.setKv(b.id, img('b.png'))
      addDeck(lib, a.id, 2, 'a')
      const app = new AppState(lib)
      app.dispatch({ type: 'next' })
      app.setEvent(b.id)
      app.dispatch({ type: 'toggleKv' })
      expect(app.state).toMatchObject({ kv: true, airEvent: b.id })
      app.dispatch({ type: 'toggleKv' })
      expect(app.state.airEvent).toBe(a.id)
    })

    it('removing the live deck keeps the air event; no events gives null', () => {
      const lib = new Library(root)
      expect(new AppState(lib).state.airEvent).toBeNull()
      const a = lib.createEvent('A')
      const b = lib.createEvent('B')
      const d = addDeck(lib, a.id, 2, 'a')
      const app = new AppState(lib)
      app.dispatch({ type: 'selectDeck', deckId: d })
      app.setEvent(b.id)
      const s = app.removeDeck(a.id, d)
      expect(s.shown).toBeNull()
      expect(s.airEvent).toBe(a.id)
    })
  })
})
