import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ElectronPageBackend + WebHost with a scripted `webContents`: the events arrive in the
 * order Chromium sends them for a real page, so the operator status is checked end to end.
 */

const fake = vi.hoisted(() => ({ windows: [] as unknown[] }))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeContents extends Emitter {
    url = ''
    title = ''
    loading = false
    session = {}
    navigationHistory = { canGoBack: () => false, canGoForward: () => false }
    getURL(): string {
      return this.url
    }
    getTitle(): string {
      return this.title
    }
    isLoading(): boolean {
      return this.loading
    }
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
    reload = (): void => undefined
    setAudioMuted = (): void => undefined
    setZoomMode = (): void => undefined
    setZoomFactor = (): void => undefined
    setWindowOpenHandler = (): void => undefined
    capturePage(): Promise<never> {
      return Promise.reject(new Error('no frame'))
    }
  }
  class FakeWindow extends Emitter {
    webContents = new FakeContents()
    private size = [0, 0]
    constructor() {
      super()
      fake.windows.push(this)
    }
    isDestroyed(): boolean {
      return false
    }
    setContentSize(w: number, h: number): void {
      this.size = [w, h]
    }
    getContentSize(): number[] {
      return this.size
    }
    isFullScreen(): boolean {
      return false
    }
    isVisible(): boolean {
      return false
    }
    destroy = (): void => undefined
  }
  const ses = {
    getUserAgent: () => 'Mozilla/5.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36',
    setUserAgent: () => undefined,
    setPermissionRequestHandler: () => undefined,
    setPermissionCheckHandler: () => undefined,
    on: () => undefined
  }
  return {
    BrowserWindow: FakeWindow,
    screen: {},
    session: { fromPartition: () => ses }
  }
})
vi.mock('./adblock', () => ({ startAdBlock: () => undefined }))

import { ElectronPageBackend } from './electron-page-backend'
import { WebHost } from './web-host'

interface Contents extends EventEmitter {
  url: string
  title: string
  loading: boolean
}

const canvas = { width: 1920, height: 1080 }
const URL_X = 'http://127.0.0.1:1/'
const deck = { id: 'dx', source: 'web', name: 'dx', web: { url: URL_X } }

function make(): { host: WebHost; wc: Contents; statuses: string[] } {
  fake.windows.length = 0
  const backend = new ElectronPageBackend({ operatorWindow: () => null, isLive: () => false })
  const state = { shown: null, frozen: false, webHold: false }
  const appState = {
    get state(): unknown {
      return state
    },
    setWebHold: (v: boolean): void => {
      state.webHold = v
    }
  }
  const lib = {
    getDeck: (id: string) => ({ ...deck, id }),
    listEvents: () => [{ id: 'ev', deckIds: [deck.id] }],
    updateWebSnapshot: (): void => undefined,
    renameDeck: (): void => undefined
  }
  const statuses: string[] = []
  const host = new WebHost(
    lib as never,
    appState as never,
    () => canvas,
    (_deckId, s) => statuses.push(s),
    backend
  )
  host.syncEvent([deck] as never, null)
  const win = fake.windows[0] as { webContents: Contents }
  return { host, wc: win.webContents, statuses }
}

/** Chromium's order for a main-frame load that fails: the error page commits in the same load. */
function failedLoad(wc: Contents): void {
  wc.loading = true
  wc.emit('did-start-loading')
  wc.emit('did-start-navigation', { url: URL_X, isMainFrame: true, isSameDocument: false })
  wc.url = URL_X
  wc.emit('did-fail-load', {}, -312, 'ERR_UNSAFE_PORT', URL_X, true)
  // The error page finishes loading while the page still reports `isLoading()`.
  wc.title = '127.0.0.1:1'
  wc.emit('page-title-updated')
  wc.emit('did-finish-load')
  wc.loading = false
  wc.emit('did-stop-loading')
}

describe('ElectronPageBackend + WebHost: a page that cannot load', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stays error after the error page loads and a frame of it is captured', () => {
    const { host, wc } = make()
    failedLoad(wc)
    host.frameSeen(deck.id)
    expect(host.statuses()[0]).toMatchObject({
      status: 'error',
      message: 'Could not open 127.0.0.1. Check the internet connection, then Reload.'
    })
    expect(host.webReady(deck.id)).toBe(false)
  })

  it('a Reload that succeeds clears the error', () => {
    const { host, wc, statuses } = make()
    failedLoad(wc)
    host.frameSeen(deck.id)
    wc.loading = true
    wc.emit('did-start-loading')
    wc.emit('did-start-navigation', { url: URL_X, isMainFrame: true, isSameDocument: false })
    expect(host.statuses()[0].status).toBe('loading')
    wc.emit('did-navigate', {}, URL_X, 200)
    wc.emit('did-finish-load')
    wc.loading = false
    wc.emit('did-stop-loading')
    expect(host.statuses()[0].status).toBe('ready')
    expect(host.webReady(deck.id)).toBe(true)
    // (WebHost re-sends `error` on every update, so compare the changes only.)
    const changes = statuses.filter((s, i) => s !== statuses[i - 1])
    expect(changes).toEqual(['loading', 'error', 'loading', 'ready'])
  })

  it('a subframe or same-document navigation does not end the error', () => {
    const { host, wc } = make()
    failedLoad(wc)
    wc.emit('did-start-navigation', {
      url: 'about:blank',
      isMainFrame: false,
      isSameDocument: false
    })
    wc.emit('did-start-navigation', { url: `${URL_X}#a`, isMainFrame: true, isSameDocument: true })
    wc.loading = true
    wc.emit('did-start-loading')
    expect(host.statuses()[0].status).toBe('error')
  })
})
