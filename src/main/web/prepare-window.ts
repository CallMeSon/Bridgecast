import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/** One Prepare window per web deck; opening it again focuses it. */
const windows = new Map<string, BrowserWindow>()

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A 1200x800 window (smaller on a small display) centred in the operator display's work area. */
export function prepareBounds(workArea: Rect): Rect {
  const width = Math.min(1200, Math.round(workArea.width * 0.9))
  const height = Math.min(800, Math.round(workArea.height * 0.9))
  return {
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2)
  }
}

/**
 * Opens the Prepare window of a web deck (hash route `#/prepare?deck=<id>` of the
 * app renderer, so main treats it as an app window). It is a normal, resizable
 * window on the operator display, never on the HDMI display. Main's frame-sender
 * role resolver counts it as `prepare`, which can never open the ready gate.
 */
export function openPrepareWindow(deckId: string, operator: BrowserWindow | null): void {
  const existing = windows.get(deckId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }
  const display =
    operator && !operator.isDestroyed()
      ? screen.getDisplayMatching(operator.getBounds())
      : screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    ...prepareBounds(display.workArea),
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#141414',
    title: 'Prepare web page',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  windows.set(deckId, win)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (windows.get(deckId) === win) windows.delete(deckId)
  })
  // The Prepare window never leaves the app page, and never opens other windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const hash = `/prepare?deck=${encodeURIComponent(deckId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`).catch(() => undefined)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash }).catch(() => undefined)
  }
}
