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
    expect(shown).toEqual({ deckId: da, index: 1 })

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
    expect(s.shown).toEqual({ deckId: da, index: 0 })
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
    expect(s).toMatchObject({ deckId: d, index: 1, shown: { deckId: d, index: 1 } })
    expect(app.state).toBe(s)
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
})
