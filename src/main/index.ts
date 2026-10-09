import { app, shell, BrowserWindow, dialog, ipcMain, protocol, session } from 'electron'
import * as path from 'path'
import { join } from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { Library } from './library'
import { AppState } from './state'
import { importPptx } from './import/pptx'
import { readFolderDeck } from './import/folder'
import { ImportQueue } from './import-queue'
import {
  VIDEO_CHUNK_BYTES,
  capRange,
  isInside,
  kvMimeType,
  parseKvUrl,
  parseRange,
  parseSlideUrl,
  parseThumbUrl
} from './slide-protocol'
import { loadSettings, saveSettings, type Settings } from './settings'
import { HdmiOutput, screenDisplays } from './display-output'
import type { ScreenDisplay } from './hdmi-plan'
import { hdmiSettingsError, resolveHdmi } from '../shared/displays'
import { permissionAllowed } from './permissions'
import {
  sanitizeAudio,
  sanitizeSettings,
  type AudioSettings,
  type HdmiSettings
} from '../shared/settings'
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
  {
    scheme: 'slide',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
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
    throw new Error(`${what} is not valid. Reload the app, then try again.`)
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function tempDir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), 'ppt-share-import-'))
}

/**
 * Serves an MP4 with byte ranges, reading only the requested slice. Every
 * answer is a 206 of at most VIDEO_CHUNK_BYTES (also for a request without
 * Range or with an open-ended `bytes=0-`), so a large clip never sits in memory.
 */
async function videoResponse(file: string, rangeHeader: string | null): Promise<Response> {
  const headers = {
    'content-type': 'video/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store'
  }
  const { size } = await fs.promises.stat(file)
  const parsed = parseRange(rangeHeader, size)
  if (parsed === 'invalid' || (parsed === null && size === 0)) {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${size}` }
    })
  }
  const range = capRange(parsed ?? { start: 0, end: size - 1 }, VIDEO_CHUNK_BYTES)
  const length = range.end - range.start + 1
  const handle = await fs.promises.open(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, range.start)
    return new Response(buf.subarray(0, bytesRead), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${range.start}-${range.start + bytesRead - 1}/${size}`,
        'content-length': String(bytesRead)
      }
    })
  } finally {
    await handle.close()
  }
}

function registerSlideProtocol(root: string, lib: Library): void {
  protocol.handle('slide', async (req) => {
    // Forms: slide://<deckId>/<file> (a slide), slide://<deckId>/thumbs/<n>.jpg (its thumbnail) and slide://kv/<eventId>/<file> (an event's KV).
    const kv = parseKvUrl(req.url)
    const thumb = kv ? null : parseThumbUrl(req.url)
    const parsed = kv || thumb ? null : parseSlideUrl(req.url)
    if (!kv && !thumb && !parsed) return new Response('Bad request', { status: 400 })
    try {
      const file = kv
        ? lib.kvFilePath(kv.eventId, kv.file)
        : thumb
          ? await lib.thumbFilePath(thumb.deckId, thumb.file)
          : parsed!.file.endsWith('.mp4')
            ? lib.videoFilePath(parsed!.deckId, parsed!.file)
            : lib.slideFilePath(parsed!.deckId, parsed!.file)
      if (!isInside(root, file)) return new Response('Forbidden', { status: 403 })
      if (parsed?.file.endsWith('.mp4')) return await videoResponse(file, req.headers.get('range'))
      // A thumbnail is a JPEG, or the full PNG when generation failed.
      const type = kv ? kvMimeType(kv.file) : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
      if (!type) return new Response('Bad request', { status: 400 })
      const data = await fs.promises.readFile(file)
      return new Response(data, {
        headers: { 'content-type': type, 'cache-control': 'no-store' }
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
    assertString(name, 'Event name')
    return lib.createEvent(name)
  })
  handle(Invoke.eventsSelect, (eventId) => {
    assertString(eventId, 'Event ID')
    return state.setEvent(eventId)
  })
  handle(Invoke.decksList, (eventId) => {
    assertString(eventId, 'Event ID')
    return lib.getDecks(eventId)
  })
  handle(Invoke.programDispatch, (action: Action) => state.dispatch(action))
  handle(Invoke.programGet, () => ({ eventId: state.eventId, state: state.state }))

  // PPT/PPTX via PowerPoint COM through the import queue: one file at a time
  // (COM must never run in parallel); a failed file never blocks the next.
  // A folder of page-NN.png / page-NN.mp4 goes through the same queue.
  // Both the "Add files" dialog and drag and drop end up here.
  const jobEvent = new Map<string, string>()
  const queue = new ImportQueue(
    async (job) => {
      const eventId = jobEvent.get(job.id)
      if (!eventId) throw new Error('Target event not found. Choose an event, then import again.')
      if (isDirectory(job.path)) {
        const deck = readFolderDeck(job.path)
        progress({ id: job.id, name: job.name, percent: 90, status: 'busy' })
        lib.addDeck(eventId, { ...deck, source: 'folder' })
        state.refresh()
        return
      }
      if (!PPTX_RE.test(job.path)) {
        throw new Error('This file type is not supported. Choose a PPTX, PPT, or PDF file.')
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
    assertString(eventId, 'Event ID')
    lib.getDecks(eventId) // throws (user-facing message) if the event does not exist
    if (!Array.isArray(files) || files.length > MAX_FILES) {
      throw new Error('The file list is not valid. Choose the files again.')
    }
    const jobs = files.map((f) => {
      if (!f || typeof f !== 'object')
        throw new Error('The file list is not valid. Choose the files again.')
      assertString(f.id, 'Import ID')
      assertString(f.path, 'File location')
      if (!path.isAbsolute(f.path)) {
        throw new Error(
          'The file location is not valid. Drag the file in from File Explorer, or use Add files.'
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
    assertString(eventId, 'Event ID')
    if (!payload || !Array.isArray(payload.pages) || payload.pages.length === 0) {
      throw new Error('The PDF render result is empty. Try importing the PDF again.')
    }
    if (!payload.pages.every((p) => p instanceof Uint8Array)) {
      throw new Error('The PDF render result is not valid. Try importing the PDF again.')
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
    assertString(eventId, 'Event ID')
    if (!Array.isArray(deckIds) || !deckIds.every((id) => typeof id === 'string')) {
      throw new Error('The deck order is not valid. Reload the app, then try again.')
    }
    state.reorderDecks(eventId, deckIds)
  })
  handle(Invoke.slidesReorder, (deckId, order) => {
    assertString(deckId, 'Deck ID')
    if (!Array.isArray(order)) {
      throw new Error('The slide order is not valid. Reload the app, then try again.')
    }
    state.reorderSlides(deckId, order)
  })
  handle(Invoke.decksRename, (eventId, deckId, name) => {
    assertString(eventId, 'Event ID')
    assertString(deckId, 'Deck ID')
    if (typeof name !== 'string')
      throw new Error('The deck name is not valid. Type a name, then try again.')
    return lib.renameDeck(eventId, deckId, name)
  })
  handle(Invoke.kvSet, (eventId, file) => {
    assertString(eventId, 'Event ID')
    assertString(file, 'File location')
    if (!path.isAbsolute(file)) {
      throw new Error(
        'The file location is not valid. Choose the KV image with Choose image or Replace image.'
      )
    }
    return state.setKv(eventId, file)
  })
  handle(Invoke.kvClear, (eventId) => {
    assertString(eventId, 'Event ID')
    return state.clearKv(eventId)
  })
  handle(Invoke.decksRemove, (eventId, deckId) => {
    assertString(eventId, 'Event ID')
    assertString(deckId, 'Deck ID')
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

  handle(Invoke.audioSet, (input: AudioSettings) => {
    const saved = settings.saveAudio(sanitizeAudio(input))
    broadcast(Broadcast.audioSettings, saved.audio)
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
    return this.save({ ...this.settings, hdmi })
  }

  saveAudio(audio: AudioSettings): Settings {
    return this.save({ ...this.settings, audio })
  }

  saveAutoAdvance(autoAdvance: boolean): Settings {
    return this.save({ ...this.settings, autoAdvance })
  }

  private save(input: Settings): Settings {
    const next = sanitizeSettings(input)
    try {
      saveSettings(this.file, next)
    } catch (err) {
      console.error('[settings] could not be saved:', err)
      throw new Error('Could not save settings. Check free disk space, then try again.')
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
        console.error('[hdmi] new display could not be saved:', err)
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
  electronApp.setAppUserModelId('com.pptshare.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Audio output labels and setSinkId need media permissions; only the app's
  // own pages get them (the HDMI output window uses the default session).
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) =>
    permissionAllowed(permission, origin, devUrl)
  )
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permissionAllowed(permission, details.requestingUrl, devUrl))
  )

  const root = app.getPath('userData')
  let lib: Library
  try {
    lib = new Library(root)
  } catch (err) {
    dialog.showErrorBox(
      'PPT Share',
      `${(err as Error).message}

Location: ${root}`
    )
    app.quit()
    return
  }
  const settings = new SettingsStore(join(root, 'settings.json'))
  const state = new AppState(lib, settings.get().autoAdvance)
  // The auto advance toggle is part of the program state; keep it saved.
  state.onChange((s) => {
    if (s.autoAdvance === settings.get().autoAdvance) return
    try {
      settings.saveAutoAdvance(s.autoAdvance)
    } catch (err) {
      console.error('[settings] auto advance could not be saved:', err)
    }
  })
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
