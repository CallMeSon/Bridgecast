import { describe, expect, it } from 'vitest'
import { WebHost } from './web-host'
import type { PageBackend, PageBackendEvents } from './page-backend'
import type { WebNavState } from '../../shared/web'

/**
 * WebHost's operator rules with a scripted backend: the ready gate, HOLD and the
 * no-op navigation rule (no HOLD for a Back that cannot go back).
 */

const canvas = { width: 1920, height: 1080 }

function make(): {
  host: WebHost
  state: { shown: unknown; frozen: boolean; webHold: boolean }
  statuses: { deckId: string; status: string }[]
  events: PageBackendEvents
  calls: string[]
  live: Map<string, boolean>
} {
  let events: PageBackendEvents | null = null
  const calls: string[] = []
  const live = new Map<string, boolean>()
  const backend: PageBackend = {
    setEvents: (e) => {
      events = e
    },
    open: async () => undefined,
    load: async (deckId) => void calls.push(`load:${deckId}`),
    reload: async (deckId) => void calls.push(`reload:${deckId}`),
    back: async (deckId) => void calls.push(`back:${deckId}`),
    forward: async (deckId) => void calls.push(`forward:${deckId}`),
    stop: () => undefined,
    key: () => undefined,
    input: () => undefined,
    setZoom: async () => undefined,
    resize: () => undefined,
    captureSource: async () => ({ id: 'window:1:0', kind: 'desktop' as const }),
    snapshot: async () => null,
    setLive: (deckId, value) => {
      live.set(deckId, value)
    },
    signOut: async () => undefined,
    close: () => undefined,
    dispose: () => undefined
  }
  const state = {
    shown: null as unknown,
    frozen: false,
    webHold: false
  }
  const appState = {
    get state(): unknown {
      return state
    },
    setWebHold: (v: boolean): void => {
      state.webHold = v
    }
  }
  const statuses: { deckId: string; status: string }[] = []
  const lib = {
    getDeck: (id: string) => ({ id, source: 'web', name: id, web: { url: `https://a.b/${id}` } }),
    listEvents: () => [{ id: 'ev', deckIds: ['d1'] }],
    updateWebSnapshot: (): void => undefined,
    setWebZoom: () => undefined,
    renameDeck: (): void => undefined
  }
  const host = new WebHost(
    lib as never,
    appState as never,
    () => canvas,
    (deckId, s) => statuses.push({ deckId, status: s }),
    backend,
    () => undefined
  )
  return { host, state, statuses, events: events as unknown as PageBackendEvents, calls, live }
}

const navState = (loading: boolean, url = 'https://a.b/d1', extra: Partial<WebNavState> = {}): WebNavState => ({
  deckId: 'd1',
  url,
  title: 'T',
  canGoBack: false,
  canGoForward: false,
  loading,
  zoom: 1,
  cursor: 'default',
  ...extra
})

const deck = { id: 'd1', source: 'web', name: 'd1', web: { url: 'https://a.b/d1' } }

describe('WebHost ready gate', () => {
  it('is closed until the page is loaded and a frame was seen', () => {
    const { host, events } = make()
    host.syncEvent([deck] as never, null)
    expect(host.webReady('d1')).toBe(false)
    events.nav(navState(true))
    expect(host.webReady('d1')).toBe(false)
    events.loaded('d1', { title: 'T', url: 'https://a.b/d1' })
    expect(host.webReady('d1')).toBe(false)
    host.frameSeen('d1')
    expect(host.webReady('d1')).toBe(true)
  })

  it('closes again when the page starts loading another document', () => {
    const { host, events, statuses } = make()
    host.syncEvent([deck] as never, null)
    events.nav(navState(true))
    events.loaded('d1', { title: 'T', url: 'https://a.b/d1' })
    host.frameSeen('d1')
    expect(host.webReady('d1')).toBe(true)
    events.nav(navState(true, 'https://a.b/other'))
    expect(host.webReady('d1')).toBe(false)
    expect(statuses.at(-1)).toEqual({ deckId: 'd1', status: 'loading' })
    events.loaded('d1', { title: 'T', url: 'https://a.b/other' })
    expect(host.webReady('d1')).toBe(true)
  })

  it('a failed page reports the error and recovers on the next successful load', () => {
    const { host, events } = make()
    host.syncEvent([deck] as never, null)
    events.loadFailed('d1', 'Could not open a.b. Check the internet connection, then Reload.')
    expect(host.statuses()[0]).toMatchObject({ status: 'error' })
    events.nav(navState(true))
    expect(host.statuses()[0]).toMatchObject({ status: 'loading' })
    events.loaded('d1', { title: 'T', url: 'https://a.b/d1' })
    expect(host.statuses()[0]).toMatchObject({ status: 'loading' })
  })
})

describe('WebHost navigation', () => {
  it('Back and Forward do nothing (and do not HOLD) when the page cannot go there', async () => {
    const { host, state, events, calls } = make()
    host.syncEvent([deck] as never, 'd1')
    state.shown = { deckId: 'd1', web: { deckId: 'd1' } }
    state.frozen = false
    events.nav(navState(false, 'https://a.b/d1', { canGoBack: false, canGoForward: false }))
    await host.back('d1')
    await host.forward('d1')
    expect(state.webHold).toBe(false)
    expect(calls).toEqual([])
  })

  it('Back on air with history HOLDS first, then goes back', async () => {
    const { host, state, events, calls } = make()
    host.syncEvent([deck] as never, 'd1')
    state.shown = { deckId: 'd1', web: { deckId: 'd1' } }
    events.nav(navState(false, 'https://a.b/d1', { canGoBack: true }))
    await host.back('d1')
    expect(state.webHold).toBe(true)
    expect(calls).toEqual(['back:d1'])
  })

  it('tells the backend which decks are on the output (the helper popup rule)', () => {
    const { host, state, live } = make()
    host.syncEvent([deck] as never, null)
    expect(live.get('d1')).toBe(false)
    state.shown = { deckId: 'd1', web: { deckId: 'd1' } }
    host.syncEvent([deck] as never, 'd1')
    expect(live.get('d1')).toBe(true)
  })
})
