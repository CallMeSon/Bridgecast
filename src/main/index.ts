import { app, shell, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import * as path from 'path'
import { join } from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Library } from './library'
import { AppState } from './state'
import { importPptx } from './import/pptx'
import { ImportQueue } from './import-queue'
import { isInside, parseSlideUrl } from './slide-protocol'
import { loadSettings, saveSettings, type Settings } from './settings'
import { HdmiOutput, screenDisplays } from './display-output'
import type { ScreenDisplay } from './hdmi-plan'
import { hdmiSettingsError, resolveHdmi } from '../shared/displays'
import { sanitizeSettings, type HdmiSettings } from '../shared/settings'
import {
  Broadcast,
  Invoke,
  type BroadcastMap,
  type ImportProgress,
  type ImportRequest,
  type InvokeChannel,
  type HdmiStatus,
  type InvokeMap,
  type RenderedDeck
} from '../shared/ipc'
import type { Action } from '../shared/program'

const IMPORT_WIDTH = 1920
const PPTX_RE = /\.pptx?$/i
/** Upper bound for one import request (a drop of a whole folder's worth of files). */
const MAX_FILES = 200

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
      const file = lib.slideFilePath(parsed.deckId, parsed.file)
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

function registerIpc(
  lib: Library,
  state: AppState,
  settings: SettingsStore,
  hdmi: HdmiOutput
): void {
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

  // PPT/PPTX via PowerPoint COM through the import queue: one file at a time
  // (COM must never run in parallel); a failed file never blocks the next.
  // Both the "Tambah file…" dialog and drag and drop end up here.
  const jobEvent = new Map<string, string>()
  const queue = new ImportQueue(
    async (job) => {
      const eventId = jobEvent.get(job.id)
      if (!eventId) throw new Error('Event tujuan tidak ditemukan. Pilih event lalu impor lagi.')
      if (!PPTX_RE.test(job.path)) {
        throw new Error('Format file tidak didukung. Pilih file PPTX, PPT, atau PDF.')
      }
      const out = tempDir()
      try {
        const deck = await importPptx(job.path, out, IMPORT_WIDTH)
        progress({ id: job.id, name: job.name, percent: 90, status: 'busy' })
        lib.addDeck(eventId, { ...deck, source: 'pptx' })
        state.refresh()
      } finally {
        fs.rmSync(out, { recursive: true, force: true })
      }
    },
    1,
    (job, status, error) => {
      if (status !== 'busy') jobEvent.delete(job.id)
      progress({
        id: job.id,
        name: job.name,
        percent: status === 'busy' ? 10 : 100,
        status,
        ...(error ? { message: error.message } : {})
      })
    }
  )
  if (process.env['PPT_OUTPUT_DUMP']) {
    Object.defineProperty(globalThis, '__pptImportQueue', { configurable: true, value: queue })
  }

  handle(Invoke.decksImport, (eventId, files: ImportRequest[]) => {
    assertString(eventId, 'Id event')
    lib.getDecks(eventId) // throws (Indonesian message) if the event does not exist
    if (!Array.isArray(files) || files.length > MAX_FILES) {
      throw new Error('Daftar file tidak valid. Pilih file lagi.')
    }
    const jobs = files.map((f) => {
      if (!f || typeof f !== 'object') throw new Error('Daftar file tidak valid. Pilih file lagi.')
      assertString(f.id, 'Id impor')
      assertString(f.path, 'Lokasi file')
      if (!path.isAbsolute(f.path)) {
        throw new Error(
          'Lokasi file tidak valid. Seret file dari Explorer atau pilih lewat Tambah file.'
        )
      }
      return { id: f.id, name: path.basename(f.path), path: f.path }
    })
    // Enqueue only; progress arrives as import:progress.
    for (const job of jobs) {
      jobEvent.set(job.id, eventId)
      queue.add(job)
    }
  })

  handle(Invoke.decksAddRendered, async (eventId, payload: RenderedDeck) => {
    assertString(eventId, 'Id event')
    if (!payload || !Array.isArray(payload.pages) || payload.pages.length === 0) {
      throw new Error('Hasil render PDF kosong. Coba impor ulang file PDF-nya.')
    }
    if (!payload.pages.every((p) => p instanceof Uint8Array)) {
      throw new Error('Hasil render PDF tidak valid. Coba impor ulang file PDF-nya.')
    }
    const out = tempDir()
    try {
      // Async writes keep the main process responsive.
      const slides = await Promise.all(
        payload.pages.map(async (page, i) => {
          const pngPath = join(out, `${String(i + 1).padStart(3, '0')}.png`)
          await fs.promises.writeFile(pngPath, page)
          return { pngPath, notes: String(payload.notes?.[i] ?? '') }
        })
      )
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
    assertString(eventId, 'Id event')
    if (!Array.isArray(deckIds) || !deckIds.every((id) => typeof id === 'string')) {
      throw new Error('Urutan deck tidak valid. Muat ulang aplikasi lalu coba lagi.')
    }
    state.reorderDecks(eventId, deckIds)
  })
  handle(Invoke.slidesReorder, (deckId, order) => {
    assertString(deckId, 'Id deck')
    if (!Array.isArray(order)) {
      throw new Error('Urutan slide tidak valid. Muat ulang aplikasi lalu coba lagi.')
    }
    state.reorderSlides(deckId, order)
  })
  handle(Invoke.decksRemove, (eventId, deckId) => {
    assertString(eventId, 'Id event')
    assertString(deckId, 'Id deck')
    state.removeDeck(eventId, deckId)
  })

  handle(Invoke.settingsGet, () => settings.get())

  handle(Invoke.displaysList, () => hdmi.displays())
  handle(Invoke.hdmiGetStatus, () => hdmi.getStatus())
  handle(Invoke.hdmiSet, (input: HdmiSettings) => {
    // Checked against the screens connected right now: a stale or forged id,
    // the primary, or the display holding the operator window is refused with
    // the fix. Turning HDMI off is always accepted.
    const displays = hdmi.displays()
    const operatorId = hdmi.operatorDisplayId()
    const error = hdmiSettingsError(input, displays, operatorId)
    if (error) throw new Error(error)
    const saved = settings.saveHdmi(resolveHdmi(input, displays, operatorId))
    hdmi.apply(saved.hdmi)
    return saved
  })

  state.onChange((s) => broadcast(Broadcast.programState, s))
}

/** settings.json: loaded once, saved atomically on every change. */
class SettingsStore {
  private settings: Settings

  constructor(private file: string) {
    this.settings = loadSettings(file)
  }

  get(): Settings {
    return this.settings
  }

  /** Saves HDMI settings (validated by the caller). */
  saveHdmi(hdmi: HdmiSettings): Settings {
    const next = sanitizeSettings({ ...this.settings, hdmi })
    try {
      saveSettings(this.file, next)
    } catch (err) {
      console.error('[settings] gagal disimpan:', err)
      throw new Error('Pengaturan tidak bisa disimpan. Periksa ruang disk lalu coba lagi.')
    }
    this.settings = next
    return next
  }
}

/** HDMI output on a second display; its status and the display list are pushed to the UI. */
function createHdmiOutput(settings: SettingsStore): HdmiOutput {
  // PPT_OUTPUT_DUMP (dev/e2e only): HDMI window state on globalThis.__pptHdmi,
  // and __pptHdmiFakeDisplays(list | null) to simulate plugging and unplugging
  // a second display on a machine that has only one.
  let fakeDisplays: ScreenDisplay[] | null = null
  const hdmi = new HdmiOutput(
    settings.get().hdmi,
    (s: HdmiStatus) => broadcast(Broadcast.hdmiStatus, s),
    (d) => broadcast(Broadcast.displaysChanged, d),
    (displayId) => {
      try {
        settings.saveHdmi({ ...settings.get().hdmi, displayId })
      } catch (err) {
        console.error('[hdmi] layar baru tidak bisa disimpan:', err)
      }
    },
    () => fakeDisplays ?? screenDisplays()
  )
  if (process.env['PPT_OUTPUT_DUMP']) {
    Object.defineProperty(globalThis, '__pptHdmi', {
      configurable: true,
      get: () => hdmi.debug
    })
    Object.defineProperty(globalThis, '__pptHdmiFakeDisplays', {
      configurable: true,
      value: (list: ScreenDisplay[] | null) => {
        fakeDisplays = list
        hdmi.onScreen()
      }
    })
  }
  return hdmi
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
  // The HDMI output window keeps the app alive otherwise.
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
  const settings = new SettingsStore(join(root, 'settings.json'))
  const hdmi = createHdmiOutput(settings)
  app.on('before-quit', () => hdmi.shutdown())
  registerSlideProtocol(root, lib)
  registerIpc(lib, state, settings, hdmi)

  const startOutputs = (): void => hdmi.start()
  hdmi.watchOperator(createWindow(startOutputs))

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) hdmi.watchOperator(createWindow(startOutputs))
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
