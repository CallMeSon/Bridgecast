import { app, shell, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Library } from './library'
import { AppState } from './state'
import { importPptx } from './import/pptx'
import { isInside, parseSlideUrl } from './slide-protocol'
import { Output } from './output'
import { loadSettings, saveSettings, type Settings } from './settings'
import { GrandiNdiSender } from './ndi/grandi-sender'
import { NdiPipeline } from './ndi/pipeline'
import { ndiSettingsError, sanitizeSettings } from '../shared/settings'
import {
  Broadcast,
  Invoke,
  type BroadcastMap,
  type ImportProgress,
  type ImportRequest,
  type InvokeChannel,
  type NdiStatus,
  type InvokeMap,
  type RenderedDeck
} from '../shared/ipc'
import type { Action } from '../shared/program'

const IMPORT_WIDTH = 1920

// Must run before `ready`: lets <img src="slide://..."> load under the CSP.
protocol.registerSchemesAsPrivileged([
  { scheme: 'slide', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function broadcast<C extends keyof BroadcastMap>(channel: C, payload: BroadcastMap[C]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function handle<C extends InvokeChannel>(
  channel: C,
  fn: (...args: InvokeMap[C]['args']) => InvokeMap[C]['result'] | Promise<InvokeMap[C]['result']>
): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as InvokeMap[C]['args'])))
}

function assertString(v: unknown, what: string): asserts v is string {
  if (typeof v !== 'string' || !v)
    throw new Error(`${what} tidak valid. Muat ulang aplikasi lalu coba lagi.`)
}

function tempDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), 'ppt-share-import-'))
}

function registerSlideProtocol(root: string, lib: Library): void {
  protocol.handle('slide', async (req) => {
    const parsed = parseSlideUrl(req.url)
    if (!parsed) return new Response('Bad request', { status: 400 })
    try {
      const file = lib.slidePath(parsed.deckId, parsed.index)
      if (!isInside(root, file)) return new Response('Forbidden', { status: 403 })
      const data = await fs.promises.readFile(file)
      return new Response(data, {
        headers: { 'content-type': 'image/png', 'cache-control': 'no-store' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function registerIpc(lib: Library, state: AppState, ndi: NdiOutput): void {
  const progress = (p: ImportProgress): void => broadcast(Broadcast.importProgress, p)

  handle(Invoke.eventsList, () => lib.listEvents())
  handle(Invoke.eventsCreate, (name) => {
    assertString(name, 'Nama event')
    return lib.createEvent(name)
  })
  handle(Invoke.eventsSelect, (eventId) => {
    assertString(eventId, 'Id event')
    return state.setEvent(eventId)
  })
  handle(Invoke.decksList, (eventId) => {
    assertString(eventId, 'Id event')
    return lib.getDecks(eventId)
  })
  handle(Invoke.programDispatch, (action: Action) => state.dispatch(action))
  handle(Invoke.programGet, () => ({ eventId: state.eventId, state: state.state }))

  // PPT/PPTX via PowerPoint COM, one file after another (COM must not run in
  // parallel). Task 9 replaces this loop with the ImportQueue.
  let chain: Promise<void> = Promise.resolve()
  handle(Invoke.decksImport, (eventId, files: ImportRequest[]) => {
    assertString(eventId, 'Id event')
    if (!Array.isArray(files)) throw new Error('Daftar file tidak valid. Pilih file lagi.')
    const run = async (): Promise<void> => {
      for (const f of files) {
        const name = String(f.path).split(/[\\/]/).pop() ?? 'file'
        const id = String(f.id)
        progress({ id, name, percent: 10, status: 'busy' })
        const out = tempDir()
        try {
          if (!/\.pptx?$/i.test(f.path)) {
            throw new Error('Format file tidak didukung. Pilih file PPTX, PPT, atau PDF.')
          }
          const deck = await importPptx(f.path, out, IMPORT_WIDTH)
          progress({ id, name, percent: 90, status: 'busy' })
          lib.addDeck(eventId, { ...deck, source: 'pptx' })
          state.refresh()
          progress({ id, name, percent: 100, status: 'done' })
        } catch (err) {
          progress({ id, name, percent: 100, status: 'error', message: (err as Error).message })
        } finally {
          fs.rmSync(out, { recursive: true, force: true })
        }
      }
    }
    chain = chain.then(run, run)
    return chain
  })

  handle(Invoke.decksAddRendered, (eventId, payload: RenderedDeck) => {
    assertString(eventId, 'Id event')
    if (!payload || !Array.isArray(payload.pages) || payload.pages.length === 0) {
      throw new Error('Hasil render PDF kosong. Coba impor ulang file PDF-nya.')
    }
    const out = tempDir()
    try {
      const slides = payload.pages.map((page, i) => {
        const pngPath = join(out, `${String(i + 1).padStart(3, '0')}.png`)
        fs.writeFileSync(pngPath, Buffer.from(page))
        return { pngPath, notes: payload.notes?.[i] ?? '' }
      })
      const deck = lib.addDeck(eventId, {
        name: String(payload.name),
        source: 'pdf',
        width: Number(payload.width),
        height: Number(payload.height),
        slides
      })
      state.refresh()
      return deck
    } finally {
      fs.rmSync(out, { recursive: true, force: true })
    }
  })

  handle(Invoke.decksReorder, (eventId, deckIds) => {
    lib.reorderDecks(eventId, deckIds)
    state.refresh()
  })
  handle(Invoke.slidesReorder, (deckId, order) => {
    lib.reorderSlides(deckId, order)
    state.refresh()
  })
  handle(Invoke.decksRemove, (eventId, deckId) => {
    lib.removeDeck(eventId, deckId)
    state.refresh()
  })

  handle(Invoke.settingsGet, () => ndi.getSettings())
  handle(Invoke.settingsSet, (settings) => ndi.set(settings))
  handle(Invoke.ndiGetStatus, () => ndi.getStatus())

  state.onChange((s) => broadcast(Broadcast.programState, s))
}

/**
 * NDI output: settings.json → NdiPipeline (offscreen output window + frame
 * repeater) → GrandiNdiSender. Status changes are pushed as `ndi:status`.
 */
class NdiOutput {
  private settings: Settings
  private status: NdiStatus = { state: 'stopped' }
  private readonly sender: GrandiNdiSender
  private readonly pipeline: NdiPipeline<Output>
  private started = false

  constructor(private file: string) {
    this.settings = loadSettings(file)
    this.sender = new GrandiNdiSender((s) => this.setStatus(s))
    // PPT_OUTPUT_DUMP=<dir> (dev/e2e only): exposes counters and a PNG frame
    // dump of the current output window on globalThis.__pptOutput, and the
    // sender's counters on globalThis.__pptNdi.
    const dumpDir = process.env['PPT_OUTPUT_DUMP'] || undefined
    this.pipeline = new NdiPipeline(
      this.sender,
      (opts, send, ready) => new Output(opts, send, dumpDir, ready),
      (message) => this.setStatus({ state: 'error', message })
    )
    if (dumpDir) {
      Object.defineProperty(globalThis, '__pptOutput', {
        configurable: true,
        get: () => this.pipeline.current?.debug ?? null
      })
      Object.defineProperty(globalThis, '__pptNdi', {
        configurable: true,
        get: () => ({ ...this.sender.stats, connections: this.sender.stats.connections() })
      })
    }
  }

  private setStatus(s: NdiStatus): void {
    this.status = s
    if (s.state === 'error') console.error(`[ndi] ${s.message}`)
    broadcast(Broadcast.ndiStatus, s)
  }

  /** Starts the output once the operator window is up. */
  start(): void {
    if (this.started) return
    this.started = true
    this.pipeline.apply(this.settings.ndi)
  }

  getSettings(): Settings {
    return this.settings
  }

  getStatus(): NdiStatus {
    return this.status
  }

  /** Validates, saves, then restarts the output window and sender as needed. */
  set(input: Settings): Settings {
    const error = ndiSettingsError(input?.ndi)
    if (error) throw new Error(error)
    const next = sanitizeSettings(input)
    try {
      saveSettings(this.file, next)
    } catch (err) {
      console.error('[settings] gagal disimpan:', err)
      throw new Error('Pengaturan tidak bisa disimpan. Periksa ruang disk lalu coba lagi.')
    }
    this.settings = next
    if (this.started) this.pipeline.apply(next.ndi)
    return next
  }

  shutdown(): void {
    this.pipeline.shutdown()
  }
}

function createWindow(onReady?: () => void): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0c0e12',
    title: 'PPT Share',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    onReady?.()
  })
  // The hidden output window keeps the app alive otherwise.
  mainWindow.on('closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:/.test(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // The operator window never navigates away from the app (e.g. a stray file drop).
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

// Lets the e2e smoke test (and power users) point the library at another folder.
if (process.env['PPT_SHARE_USER_DATA']) {
  app.setPath('userData', process.env['PPT_SHARE_USER_DATA'])
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const root = app.getPath('userData')
  let lib: Library
  try {
    lib = new Library(root)
  } catch (err) {
    dialog.showErrorBox(
      'PPT Share',
      `${(err as Error).message}

Lokasi: ${root}`
    )
    app.quit()
    return
  }
  const state = new AppState(lib)
  const ndi = new NdiOutput(join(root, 'settings.json'))
  app.on('before-quit', () => ndi.shutdown())
  registerSlideProtocol(root, lib)
  registerIpc(lib, state, ndi)

  createWindow(() => ndi.start())

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(() => ndi.start())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
