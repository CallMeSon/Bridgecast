import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeWebEngine } from './fake-web-engine'
import { WebView2PageBackend } from './webview2-backend'
import { loadFailedText, type PageBackendEvents } from './page-backend'
import type { WebNavState } from '../../shared/web'

const canvas = { width: 1920, height: 1080 }
const nav = (deckId: string, rest: Partial<WebNavState> = {}): WebNavState => ({
  deckId,
  url: 'https://canva.com/x',
  title: 'Canva',
  canGoBack: false,
  canGoForward: false,
  loading: false,
  zoom: 1,
  cursor: 'default',
  ...rest
})

let engine: FakeWebEngine
let backend: WebView2PageBackend
let events: PageBackendEvents
let thumbs: { id: string; thumbnail: { toPNG(): Buffer } }[]

function make(): void {
  engine = new FakeWebEngine()
  engine.open = async (deckId, o) => {
    engine.opened.set(deckId, o)
    return { windowId: '4242', audioPipe: '\\\\.\\pipe\\web-audio-1-2' }
  }
  backend = new WebView2PageBackend(engine, {
    getSources: async () => [{ id: 'window:4242:0' }, { id: 'window:9999:0' }],
    thumbnailSources: async () => thumbs
  })
  events = {
    nav: vi.fn(),
    loaded: vi.fn(),
    loadFailed: vi.fn(),
    crashed: vi.fn(),
    hung: vi.fn(),
    warning: vi.fn(),
    closed: vi.fn()
  }
  backend.setEvents(events)
}

beforeEach(() => {
  thumbs = [{ id: 'window:4242:0', thumbnail: { toPNG: () => Buffer.from([1, 2, 3]) } }]
  make()
})

/** The behavior every PageBackend must give WebHost (both backends are used the same way). */
describe('PageBackend contract', () => {
  it('opens a page with the canvas, zoom and profile, and keeps its sound pipe', async () => {
    await backend.open('d1', {
      url: 'https://canva.com/x',
      canvas,
      zoom: 1.5,
      profile: 'deck-1'
    })
    expect(engine.opened.get('d1')).toEqual({
      url: 'https://canva.com/x',
      canvas,
      zoom: 1.5,
      profile: 'deck-1',
      live: false
    })
    expect(backend.audioPipe('d1')).toBe('\\\\.\\pipe\\web-audio-1-2')
    expect(backend.audioPipe('other')).toBeNull()
  })

  it('forwards navigation commands and reloading', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await backend.load('d1', 'https://c.d')
    await backend.reload('d1')
    await backend.back('d1')
    await backend.forward('d1')
    await backend.setZoom('d1', 2)
    expect(engine.opened.get('d1')?.url).toBe('https://c.d')
    expect(engine.opened.get('d1')?.zoom).toBe(2)
  })

  it('resizes every open page to the canvas', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await backend.open('d2', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    const next = { width: 2520, height: 1080 }
    backend.resize(next)
    await Promise.resolve()
    expect(engine.sizes.get('d1')).toEqual(next)
    expect(engine.sizes.get('d2')).toEqual(next)
  })

  it('reports nav, loaded, failed and crashed pages to WebHost', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    engine.emitNav(nav('d1', { title: 'Page', url: 'https://a.b/p' }))
    expect(events.nav).toHaveBeenCalledWith(nav('d1', { title: 'Page', url: 'https://a.b/p' }))

    engine.emitStatus('d1', 'ready')
    expect(events.loaded).toHaveBeenCalledWith('d1', { title: 'Page', url: 'https://a.b/p' })

    engine.emitStatus('d1', 'error', 'Could not open a.b. Try again.')
    expect(events.loadFailed).toHaveBeenCalledWith('d1', 'Could not open a.b. Try again.')

    engine.emitCrashed('d1')
    expect(events.crashed).toHaveBeenCalledWith('d1', loadFailedText('a.b'))
  })

  it('a crashed page reports the error and then recovers when the helper reloads it', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    engine.emitNav(nav('d1'))
    engine.emitCrashed('d1')
    expect(events.crashed).toHaveBeenCalledTimes(1)
    engine.emitStatus('d1', 'ready')
    expect(events.loaded).toHaveBeenCalledWith('d1', { title: 'Canva', url: 'https://canva.com/x' })
  })

  it('reports a helper exit as a crash of every open page', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await backend.open('d2', { url: 'https://c.d', canvas, zoom: 1, profile: 'default' })
    engine.emitExit()
    expect(events.crashed).toHaveBeenCalledTimes(2)
  })

  it('captures the helper window (desktop kind), never a screen', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await expect(backend.captureSource('d1', null)).resolves.toEqual({
      id: 'window:4242:0',
      kind: 'desktop'
    })
    await expect(backend.captureSource('missing', null)).rejects.toThrow(
      'The web page is not open. Reload the deck, then try again.'
    )
  })

  it('snapshots the helper window with a thumbnail, and nothing when it is gone', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await expect(backend.snapshot('d1')).resolves.toEqual(Buffer.from([1, 2, 3]))
    thumbs = []
    await expect(backend.snapshot('d1')).resolves.toBeNull()
    await expect(backend.snapshot('missing')).resolves.toBeNull()
  })

  it('sends one key down and one key up for Next/Prev', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    backend.key('d1', 'ArrowRight')
    expect(engine.inputs.map((i) => [i.ev.kind, (i.ev as { type?: string }).type, (i.ev as { keyCode?: string }).keyCode])).toEqual([
      ['key', 'keyDown', 'ArrowRight'],
      ['key', 'keyUp', 'ArrowRight']
    ])
  })

  it('turns a validated pixel input event into the page normalized space', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    backend.input('d1', {
      type: 'mouseDown',
      x: 480,
      y: 270,
      button: 'left',
      clickCount: 1
    } as Electron.MouseInputEvent)
    expect(engine.inputs.at(-1)?.ev).toEqual({
      kind: 'mouse',
      type: 'mouseDown',
      x: 0.25,
      y: 0.25,
      button: 'left',
      clickCount: 1
    })
    backend.input('d1', {
      type: 'mouseWheel',
      x: 1920,
      y: 1080,
      deltaX: 0,
      deltaY: -120,
      canScroll: true
    } as Electron.MouseWheelInputEvent)
    expect(engine.inputs.at(-1)?.ev).toEqual({
      kind: 'wheel',
      x: 1,
      y: 1,
      deltaX: 0,
      deltaY: -120
    })
    backend.input('d1', {
      type: 'keyDown',
      keyCode: 'ArrowRight',
      modifiers: ['shift']
    } as Electron.KeyboardInputEvent)
    expect(engine.inputs.at(-1)?.ev).toEqual({
      kind: 'key',
      type: 'keyDown',
      keyCode: 'ArrowRight',
      modifiers: ['shift']
    })
  })

  it('tells the helper when the deck goes on or off the output, and stops a load', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    backend.setLive('d1', true)
    backend.setLive('missing', true)
    await Promise.resolve()
    expect(engine.live.get('d1')).toBe(true)
    expect(engine.live.has('missing')).toBe(false)
    backend.stop('d1')
    expect(engine.stopped).toEqual(['d1'])
  })

  it('reports a hung page so WebHost can HOLD it', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    engine.emitHung('d1')
    engine.emitHung('missing')
    expect(events.hung).toHaveBeenCalledWith('d1')
    expect(events.hung).toHaveBeenCalledTimes(1)
  })

  it('passes the live flag to open', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default', live: true })
    expect(engine.opened.get('d1')?.live).toBe(true)
  })

  it('closes a page, signs out its profile and shuts the helper down', async () => {
    await backend.open('d1', { url: 'https://a.b', canvas, zoom: 1, profile: 'default' })
    await backend.open('d2', { url: 'https://c.d', canvas, zoom: 1, profile: 'deck-2' })
    await backend.signOut(['default', 'deck-2', 'default'])
    expect(engine.signedOut).toEqual(['default', 'deck-2'])
    backend.close('d1')
    await Promise.resolve()
    expect(engine.closed).toContain('d1')
    expect(backend.audioPipe('d1')).toBeNull()
    backend.dispose()
    await Promise.resolve()
    expect(engine.alive).toBe(false)
  })
})
