import { BrowserWindow, MessageChannelMain, type MessagePortMain } from 'electron'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { is } from '@electron-toolkit/utils'
import { OMT_AUDIO_PORT, Send } from '../shared/ipc'
import type { OmtSettings, OmtStatus } from '../shared/omt'
import { libomtDir } from './omt/lib-dir'
import { AudioPortFeed } from './omt/audio-port'
import {
  OmtController,
  RESTART_DELAY_MS,
  STOP_WAIT_MS,
  type OmtDeps,
  type OmtWindowLike,
  type WindowHandlers,
  type WorkerLike
} from './omt/output'
// Importing the worker path is what makes electron-vite emit out/main/worker-*.js.
import { omtWorkerPath } from './omt/worker-path'

export type { OmtDebug } from './omt/output'

/** Offscreen window rendering `#/output?role=omt`; its frames go to the OMT worker. */
function createOmtWindow(
  h: WindowHandlers,
  size: { width: number; height: number },
  fps: number
): OmtWindowLike {
  const win = new BrowserWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    // The screen's work area would otherwise clamp the frames (seen in the spike).
    enableLargerThanScreen: true,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#000000',
    title: 'PPT Share OMT',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: { deviceScaleFactor: 1 },
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  win.setContentSize(size.width, size.height)
  const wc = win.webContents
  wc.setFrameRate(fps)
  // Only this window's own renderer can make it ready (webContents.ipc).
  wc.ipc.on(Send.outputReady, () => h.onReady())
  wc.on('paint', (_e, _dirty, image) => {
    const b = image.toBitmap()
    const { width, height } = image.getSize()
    const data =
      b.byteOffset === 0 && b.byteLength === b.buffer.byteLength
        ? (b.buffer as ArrayBuffer)
        : (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
    h.onPaint(width, height, data)
  })
  win.on('close', (e) => {
    if (!win.isDestroyed()) e.preventDefault()
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  wc.on('render-process-gone', (_e, details) => {
    console.error(`[omt] renderer stopped (${details.reason})`)
    h.onGone()
  })
  // Output only: no keyboard/mouse input, no navigation, no popups.
  wc.on('before-input-event', (e) => e.preventDefault())
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Program sound: every request (and the first load) builds a fresh channel.
  const feed = new AudioPortFeed(
    () => new MessageChannelMain(),
    (port1) => {
      if (!win.isDestroyed()) wc.postMessage(OMT_AUDIO_PORT, null, [port1 as MessagePortMain])
    },
    h.onAudio
  )
  wc.ipc.on(Send.omtAudioPortRequest, () => feed.request())
  wc.once('did-finish-load', () => feed.request())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/output?role=omt`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/output?role=omt' })
  }

  return {
    resize: (w, hh) => {
      if (!win.isDestroyed()) win.setContentSize(w, hh)
    },
    setFrameRate: (n) => {
      if (!win.isDestroyed()) wc.setFrameRate(n)
    },
    invalidate: () => {
      if (!win.isDestroyed()) wc.invalidate()
    },
    destroy: () => {
      feed.close()
      if (!win.isDestroyed()) win.destroy()
    }
  }
}

/** The OMT network output: offscreen renderer → worker thread → libomt. See omt/output.ts. */
export class OmtOutput extends OmtController {
  constructor(
    settings: OmtSettings,
    canvas: () => { width: number; height: number },
    onStatus: (s: OmtStatus) => void,
    opts: { fake?: boolean; debug?: boolean } = {}
  ) {
    const deps: OmtDeps = {
      createWorker: (): WorkerLike =>
        new Worker(omtWorkerPath, {
          workerData: { libDir: libomtDir(), fake: opts.fake === true }
        }) as unknown as WorkerLike,
      createWindow: createOmtWindow,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      restartDelayMs: RESTART_DELAY_MS,
      stopWaitMs: STOP_WAIT_MS
    }
    super(settings, canvas, onStatus, deps, opts.debug === true)
  }
}
