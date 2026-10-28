import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AppState } from '../state'
import type { Library } from '../library'
import type { DeckMeta } from '../../shared/types'
import { FakeEngine } from './fake-engine'
import { SlideShowManager } from './manager'

function deck(id: string, playback: DeckMeta['playback'], clicks: number[]): DeckMeta {
  return {
    id,
    name: id,
    source: playback === 'native' ? 'pptx' : 'pdf',
    width: 1920,
    height: 1080,
    playback,
    slides: clicks.map((c, i) => ({ file: `${id}-${i}.png`, notes: '', clicks: c }))
  }
}

let decks: DeckMeta[]
let canvas: { width: number; height: number }
let engine: FakeEngine
let app: AppState
let mgr: SlideShowManager
let dispatched: string[]

async function goLive(id: string): Promise<void> {
  app.dispatch({ type: 'selectDeck', deckId: id })
  await flush()
  app.dispatch({ type: 'goto', index: 0 })
  await flush()
  engine.calls.length = 0
}

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

function setup(): void {
  const lib = {
    listEvents: () => [{ id: 'e', name: 'E', deckIds: decks.map((d) => d.id) }],
    getDecks: () => decks
  } as unknown as Library
  engine = new FakeEngine(() => decks)
  app = new AppState(lib, false, undefined, undefined, undefined, (id) => mgr.ready(id))
  const orig = app.dispatch.bind(app)
  dispatched = []
  app.dispatch = (a) => {
    dispatched.push(a.type)
    return orig(a)
  }
  mgr = new SlideShowManager(
    engine,
    app,
    () => decks,
    () => canvas,
    (id) => `${id}.pptx`
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  canvas = { width: 1920, height: 1080 }
  decks = [
    deck('a', 'native', [2, 0, 1]),
    deck('b', 'native', [0, 0]),
    deck('img', 'images', [0]),
    deck('c', 'native', [0])
  ]
  setup()
})
afterEach(() => {
  mgr.dispose()
  vi.useRealTimers()
})

describe('SlideShowManager', () => {
  it('is not ready until the open resolves', async () => {
    engine.delayReady(500)
    mgr.sync()
    app.dispatch({ type: 'selectDeck', deckId: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    expect(mgr.ready('a')).toBe(false)
    expect(mgr.windowId('a')).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    expect(mgr.ready('a')).toBe(true)
    expect(mgr.windowId('a')).toBe('win-a')
  })

  it('records the first captured frame of an open deck and forgets it with the session', async () => {
    app.dispatch({ type: 'selectDeck', deckId: 'a' })
    await flush()
    mgr.frameSeen('nope') // no session: ignored
    expect(mgr.hasFrame('nope')).toBe(false)
    expect(mgr.hasFrame('a')).toBe(false)
    mgr.frameSeen('a')
    expect(mgr.hasFrame('a')).toBe(true)
    app.dispatch({ type: 'selectDeck', deckId: 'c' })
    await flush()
    await flush()
    expect(mgr.hasFrame('a')).toBe(false)
  })

  it('pre-opens the next native deck and never has more than 2 sessions', async () => {
    app.dispatch({ type: 'selectDeck', deckId: 'a' })
    await flush()
    expect(mgr.ready('a')).toBe(true)
    expect(mgr.ready('b')).toBe(true)
    expect(mgr.ready('c')).toBe(false)
    app.dispatch({ type: 'selectDeck', deckId: 'b' })
    await flush()
    app.dispatch({ type: 'nextDeck' })
    await flush()
    await flush()
    expect(engine.maxOpen).toBeLessThanOrEqual(2)
    expect(engine.openCount).toBeLessThanOrEqual(2)
    expect(mgr.ready('a')).toBe(false)
  })

  it('step forward calls next and dispatches the engine position', async () => {
    await goLive('a')
    dispatched.length = 0
    app.dispatch({ type: 'next' })
    await flush()
    expect(engine.calls).toContain('next:a')
    expect(dispatched).toContain('enginePosition')
    expect(app.state.shown?.step).toBe(1)
  })

  it('a jump calls goto', async () => {
    await goLive('a')
    app.dispatch({ type: 'goto', index: 2 })
    await flush()
    expect(engine.calls).toContain('goto:a:2')
    expect(app.state.shown?.index).toBe(2)
  })

  it('stepping back calls prev', async () => {
    await goLive('a')
    app.dispatch({ type: 'next' })
    await flush()
    app.dispatch({ type: 'prev' })
    await flush()
    expect(engine.calls).toContain('prev:a')
    expect(app.state.shown?.step).toBe(0)
  })

  it('a hung engine falls back after 3000 ms and ready is false', async () => {
    await goLive('a')
    expect(app.state.shown?.playback).toBe('native')
    engine.delayReady(10_000) // the restart takes a while
    engine.hang()
    await vi.advanceTimersByTimeAsync(2000)
    expect(app.state.shown?.playback).toBe('native')
    await vi.advanceTimersByTimeAsync(1100)
    expect(dispatched).toContain('nativeFallback')
    expect(app.state.shown?.playback).toBe('images')
    expect(mgr.ready('a')).toBe(false)
  })

  it('restarts the engine in the background and resumes once a session is ready', async () => {
    await goLive('a')
    engine.hang()
    await vi.advanceTimersByTimeAsync(4500)
    expect(engine.shutdowns).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(dispatched).toContain('resumeNative')
    expect(app.state.shown?.playback).toBe('native')
    expect(mgr.ready('a')).toBe(true)
  })

  it('a crashed engine falls back too', async () => {
    await goLive('a')
    engine.delayReady(10_000)
    engine.crash()
    await flush()
    expect(app.state.shown?.playback).toBe('images')
    expect(mgr.ready('a')).toBe(false)
  })

  it('stays on images (not ready) while fallen back and the engine is still down', async () => {
    await goLive('a')
    engine.delayReady(10_000)
    engine.hang()
    await vi.advanceTimersByTimeAsync(3100)
    expect(mgr.ready('a')).toBe(false)
    app.dispatch({ type: 'goto', index: 1 })
    expect(app.state.shown?.playback).toBe('images')
  })

  it('a canvas change reopens non-live sessions only', async () => {
    await goLive('a')
    expect(engine.opens.map((o) => o.deckId)).toEqual(['a', 'b'])
    canvas = { width: 1280, height: 720 }
    mgr.sync()
    await flush()
    await flush()
    const reopened = engine.opens.slice(2)
    expect(reopened.map((o) => o.deckId)).toEqual(['b'])
    expect(reopened[0].canvas).toEqual({ width: 1280, height: 720 })
    expect(engine.maxOpen).toBeLessThanOrEqual(2)
  })

  it('the engine position wins when it counts other clicks than SlideMeta', async () => {
    await goLive('a')
    engine.setEngineClicks('a', [0, 0, 0]) // meta says 2 on slide 0
    const takes: number[] = []
    const orig = app.dispatch
    app.dispatch = (a) => {
      const before = app.state.take
      const r = orig(a)
      if (a.type === 'enginePosition') takes.push(app.state.take - before)
      return r
    }
    app.dispatch({ type: 'next' }) // reducer: step 1 of slide 0
    expect(app.state.shown?.step).toBe(1)
    await flush()
    expect(engine.calls).toContain('next:a')
    expect(takes.length).toBeGreaterThan(0)
    expect(takes.every((d) => d === 0)).toBe(true)
    expect(app.state.shown?.index).toBe(1)
    expect(app.state.shown?.step).toBe(0)
    // Next is not stuck
    app.dispatch({ type: 'next' })
    await flush()
    expect(app.state.shown?.index).toBe(2)
  })

  it('navigation during a hang is abandoned and the engine is driven again after the restart', async () => {
    await goLive('a')
    engine.hang()
    app.dispatch({ type: 'next' })
    await vi.advanceTimersByTimeAsync(3100)
    expect(dispatched).toContain('nativeFallback')
    await vi.advanceTimersByTimeAsync(2000)
    expect(app.state.shown?.playback).toBe('native')
    engine.calls.length = 0
    app.dispatch({ type: 'goto', index: 2 })
    await flush()
    expect(engine.calls).toContain('goto:a:2')
    expect(app.state.shown?.index).toBe(2)
  })

  it('a healthy engine is not declared hung again after a restart', async () => {
    await goLive('a')
    engine.hang()
    await vi.advanceTimersByTimeAsync(4500)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(dispatched.filter((t) => t === 'nativeFallback')).toHaveLength(1)
    expect(app.state.shown?.playback).toBe('native')
    expect(mgr.ready('a')).toBe(true)
  })

  it('restarts even if shutdown hangs', async () => {
    await goLive('a')
    engine.hangShutdown()
    engine.hang()
    await vi.advanceTimersByTimeAsync(3100)
    expect(app.state.shown?.playback).toBe('images')
    await vi.advanceTimersByTimeAsync(4000)
    expect(app.state.shown?.playback).toBe('native')
    expect(mgr.ready('a')).toBe(true)
  })

  it('an engine error for a deck closes its session and a retry stays within 2 sessions', async () => {
    await goLive('a')
    engine.emitError('a', 'boom')
    await flush()
    expect(engine.calls).toContain('close:a')
    expect(app.state.shown?.playback).toBe('images')
    expect(mgr.ready('a')).toBe(false)
    await vi.advanceTimersByTimeAsync(3100)
    expect(engine.maxOpen).toBeLessThanOrEqual(2)
    expect(engine.openCount).toBeLessThanOrEqual(2)
    expect(mgr.ready('a')).toBe(true)
    expect(app.state.shown?.playback).toBe('native')
  })

  it('rapid take changes A,B,C,A in one tick stay within 2 sessions', async () => {
    for (const id of ['a', 'b', 'c', 'a']) app.dispatch({ type: 'selectDeck', deckId: id })
    for (let i = 0; i < 5; i++) await flush()
    expect(engine.maxOpen).toBeLessThanOrEqual(2)
    expect(engine.openCount).toBeLessThanOrEqual(2)
    expect(mgr.ready('a')).toBe(true)
  })

  it('a restart racing a close recovers within the cap', async () => {
    await goLive('a')
    engine.hang()
    app.dispatch({ type: 'selectDeck', deckId: 'c' }) // closes a and b, which hang
    await vi.advanceTimersByTimeAsync(8000)
    expect(engine.openCount).toBeLessThanOrEqual(2)
    expect(engine.maxOpen).toBeLessThanOrEqual(2)
    expect(mgr.ready('c')).toBe(true)
  })

  it('dispose leaves no timers', async () => {
    await goLive('a')
    mgr.dispose()
    await flush()
    expect(vi.getTimerCount()).toBe(0)
  })
})
