import type { CaptureSource, PageBackend, PageBackendEvents, PageSize } from './page-backend'
import { loadFailedText } from './page-backend'
import type { WebPageEngine } from './web-engine'
import type { WebNavState } from '../../shared/web'
import { webDomain } from '../../shared/web'
import { slideshowSourceId } from '../slideshow/capture'

/** What the app uses to find the helper window's `desktopCapturer` source (injected in tests). */
type GetSources = (types: ['window']) => Promise<{ id: string; thumbnail?: unknown }[]>
type ThumbnailSources = (
  opts: { types: ['window']; thumbnailSize: { width: number; height: number } }
) => Promise<{ id: string; thumbnail: { toPNG(): Buffer } }[]>

interface WebView2BackendOptions {
  /** `desktopCapturer.getSources`, as main passes it. */
  getSources: GetSources
  /** `desktopCapturer.getSources` with a thumbnail, for the snapshot (never black). */
  thumbnailSources?: ThumbnailSources
}

interface PageState {
  windowId: string
  audioPipe: string | null
  canvas: PageSize
  lastNav?: WebNavState
  /** A crash was reported; the helper reloads behind the scenes. */
  crashed: boolean
}

/**
 * Web deck pages in `web-bridge.exe`: each deck is a WebView2 window the helper owns, and
 * the outputs capture it with `desktopCapturer` (`chromeMediaSource: 'desktop'`). Sound
 * arrives through the helper's PCM pipe, not through the capture.
 */
export class WebView2PageBackend implements PageBackend {
  private pages = new Map<string, PageState>()
  private events: PageBackendEvents | null = null

  constructor(
    private engine: WebPageEngine,
    private opts: WebView2BackendOptions
  ) {
    engine.on('nav', (s) => {
      const p = this.pages.get(s.deckId)
      if (p) p.lastNav = s
      this.events?.nav(s)
    })
    engine.on('status', (s) => {
      const p = this.pages.get(s.deckId)
      if (!p) return
      if (s.status === 'ready') {
        if (p.crashed) return
        this.events?.loaded(s.deckId, {
          title: p.lastNav?.title ?? '',
          url: p.lastNav?.url ?? ''
        })
        return
      }
      if (s.status === 'error') {
        const domain = webDomain(p.lastNav?.url ?? '')
        this.events?.loadFailed(s.deckId, s.message || loadFailedText(domain))
      }
      // `loading` is reported through `nav`; WebHost derives the status itself.
    })
    engine.on('crashed', (deckId) => {
      const p = this.pages.get(deckId)
      if (!p) return
      p.crashed = true
      this.events?.crashed(deckId, loadFailedText(webDomain(p.lastNav?.url ?? '')))
    })
    engine.on('exited', () => {
      for (const deckId of [...this.pages.keys()]) {
        const p = this.pages.get(deckId)
        this.events?.crashed(deckId, loadFailedText(webDomain(p?.lastNav?.url ?? '')))
      }
    })
  }

  setEvents(events: PageBackendEvents): void {
    this.events = events
  }

  async open(
    deckId: string,
    o: { url: string; canvas: PageSize; zoom: number; profile: string }
  ): Promise<void> {
    const r = await this.engine.open(deckId, o)
    this.pages.set(deckId, {
      windowId: r.windowId,
      audioPipe: r.audioPipe,
      canvas: o.canvas,
      crashed: false
    })
  }

  async load(deckId: string, url: string): Promise<void> {
    const p = this.pages.get(deckId)
    if (p) p.crashed = false
    await this.engine.navigate(deckId, url)
  }

  async reload(deckId: string): Promise<void> {
    const p = this.pages.get(deckId)
    if (p) p.crashed = false
    await this.engine.reload(deckId)
  }

  async back(deckId: string): Promise<void> {
    await this.engine.back(deckId)
  }

  async forward(deckId: string): Promise<void> {
    await this.engine.forward(deckId)
  }

  /** The helper has no stop command: a load ends by reloading or navigating away. */
  stop(deckId: string): void {
    void deckId
  }

  key(deckId: string, key: 'ArrowRight' | 'ArrowLeft'): void {
    this.engine.input(deckId, { kind: 'key', type: 'keyDown', keyCode: key, modifiers: [] })
    this.engine.input(deckId, { kind: 'key', type: 'keyUp', keyCode: key, modifiers: [] })
  }

  /**
   * The validated Electron pixel event, in the page's normalized space. The helper turns it
   * into DevTools input for its own CSS viewport, so it survives zoom and window resizes.
   */
  input(deckId: string, ev: Electron.InputEvent): void {
    const p = this.pages.get(deckId)
    if (!p) return
    const e = ev as unknown as Record<string, unknown>
    const { width: w, height: h } = p.canvas
    const unit = (v: unknown, size: number): number =>
      Math.min(Math.max((typeof v === 'number' ? v : 0) / size, 0), 1)
    const type = String(e.type)
    if (type === 'mouseWheel') {
      this.engine.input(deckId, {
        kind: 'wheel',
        x: unit(e.x, w),
        y: unit(e.y, h),
        deltaX: typeof e.deltaX === 'number' ? e.deltaX : 0,
        deltaY: typeof e.deltaY === 'number' ? e.deltaY : 0
      })
      return
    }
    if (type === 'keyDown' || type === 'keyUp' || type === 'char') {
      this.engine.input(deckId, {
        kind: 'key',
        type,
        keyCode: String(e.keyCode ?? ''),
        modifiers: Array.isArray(e.modifiers) ? (e.modifiers as string[]) : []
      })
      return
    }
    if (type === 'mouseLeave') {
      this.engine.input(deckId, {
        kind: 'mouse',
        type: 'mouseLeave',
        x: 0,
        y: 0,
        button: 'left',
        clickCount: 0
      })
      return
    }
    this.engine.input(deckId, {
      kind: 'mouse',
      type: type as 'mouseDown' | 'mouseUp' | 'mouseMove',
      x: unit(e.x, w),
      y: unit(e.y, h),
      button: (e.button as 'left' | 'right' | 'middle') ?? 'left',
      clickCount: typeof e.clickCount === 'number' ? e.clickCount : 0
    })
  }

  async setZoom(deckId: string, zoom: number): Promise<void> {
    await this.engine.setZoom(deckId, zoom)
  }

  resize(canvas: PageSize): void {
    for (const [deckId, p] of this.pages) {
      p.canvas = canvas
      void this.engine.resize(deckId, canvas).catch(() => undefined)
    }
  }

  async captureSource(deckId: string, requester: unknown): Promise<CaptureSource> {
    void requester // the helper window is captured with a fresh source id, not per requester
    const p = this.pages.get(deckId)
    if (!p) throw new Error('The web page is not open. Reload the deck, then try again.')
    const id = await slideshowSourceId(p.windowId, (types) => this.opts.getSources(types))
    return { id, kind: 'desktop' }
  }

  /** A picture of the helper window (never a screen), for the snapshot fallback. */
  async snapshot(deckId: string): Promise<Buffer | null> {
    const p = this.pages.get(deckId)
    if (!p || !this.opts.thumbnailSources) return null
    try {
      const sources = await this.opts.thumbnailSources({
        types: ['window'],
        thumbnailSize: { width: p.canvas.width, height: p.canvas.height }
      })
      const prefix = `window:${p.windowId}:`
      const source = sources.find((s) => s.id.startsWith(prefix))
      if (!source) return null
      const png = source.thumbnail.toPNG()
      return png && png.length > 0 ? png : null
    } catch (e) {
      console.warn('[web] helper window snapshot failed:', e instanceof Error ? e.message : e)
      return null
    }
  }

  popups(): number {
    return 0
  }

  audioPipe(deckId: string): string | null {
    return this.pages.get(deckId)?.audioPipe ?? null
  }

  setMuted(deckId: string, muted: boolean): void {
    if (!this.pages.has(deckId)) return
    void this.engine.setMuted(deckId, muted).catch(() => undefined)
  }

  /** After the supervisor restarted the helper: the pages have new windows and pipes. */
  applyReopened(pages: Map<string, { windowId: string; audioPipe: string | null }>): void {
    for (const [deckId, r] of pages) {
      const p = this.pages.get(deckId)
      if (!p) continue
      p.windowId = r.windowId
      p.audioPipe = r.audioPipe
    }
  }

  async debug(deckId: string): Promise<Record<string, unknown> | null> {
    const p = this.pages.get(deckId)
    if (!p) return null
    return {
      windowOpen: false,
      contentSize: [p.canvas.width, p.canvas.height],
      sizeOk: true,
      url: p.lastNav?.url ?? ''
    }
  }

  async signOut(profiles: string[]): Promise<void> {
    for (const profile of new Set(profiles)) {
      await this.engine.signOut(profile).catch((e: unknown) => {
        console.warn('[web] sign out failed:', e instanceof Error ? e.message : e)
      })
    }
  }

  close(deckId: string): void {
    this.pages.delete(deckId)
    void this.engine.close(deckId).catch(() => undefined)
  }

  dispose(): void {
    this.pages.clear()
    void this.engine.shutdown().catch(() => undefined)
  }
}
