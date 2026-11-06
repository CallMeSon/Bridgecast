import { app, BrowserWindow, screen } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
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

const PREPARE_MIN = { width: 800, height: 560 }
/** Part of a saved window that must be on a display for the saved spot to count as reachable. */
const MIN_VISIBLE = { width: 160, height: 80 }

/** 92% of the work area, at most 1600x1000, centred. */
export function prepareBounds(workArea: Rect): Rect {
  const width = Math.min(1600, Math.round(workArea.width * 0.92))
  const height = Math.min(1000, Math.round(workArea.height * 0.92))
  return {
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2)
  }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * A saved window rectangle made safe for the displays that exist now, or null when it is
 * corrupt or not reachable (then the caller uses the default). The size is kept (but
 * never below the minimum or above the display) and the spot is pulled inside the work
 * area of the display it mostly sits on.
 */
export function clampSavedBounds(saved: unknown, workAreas: Rect[]): Rect | null {
  if (typeof saved !== 'object' || saved === null) return null
  const r = saved as Record<string, unknown>
  const n = [r.x, r.y, r.width, r.height]
  if (!n.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  const [x, y, w, h] = n as number[]
  if (w < PREPARE_MIN.width || h < PREPARE_MIN.height || w > 20000 || h > 20000) return null
  const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
  let best: Rect | null = null
  let bestArea = 0
  for (const wa of workAreas) {
    const o = overlap(rect, wa)
    if (o.width < MIN_VISIBLE.width || o.height < MIN_VISIBLE.height) continue
    if (o.width * o.height > bestArea) {
      bestArea = o.width * o.height
      best = wa
    }
  }
  if (!best) return null
  const width = Math.min(rect.width, best.width)
  const height = Math.min(rect.height, best.height)
  return {
    width: Math.max(width, Math.min(PREPARE_MIN.width, best.width)),
    height: Math.max(height, Math.min(PREPARE_MIN.height, best.height)),
    x: Math.min(Math.max(rect.x, best.x), best.x + best.width - width),
    y: Math.min(Math.max(rect.y, best.y), best.y + best.height - height)
  }
}

const boundsFile = (): string => join(app.getPath('userData'), 'prepare-window.json')

function loadBounds(): Rect | null {
  try {
    const saved: unknown = JSON.parse(readFileSync(boundsFile(), 'utf8'))
    return clampSavedBounds(
      saved,
      screen.getAllDisplays().map((d) => d.workArea)
    )
  } catch {
    return null
  }
}

function saveBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
  try {
    writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()))
  } catch (e) {
    console.warn('[prepare] window size not saved:', e)
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
    ...(loadBounds() ?? prepareBounds(display.workArea)),
    minWidth: PREPARE_MIN.width,
    minHeight: PREPARE_MIN.height,
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
  // The size and spot are remembered per PC. Only this window's size changes: the page
  // window that feeds the output keeps its canvas size.
  let timer: NodeJS.Timeout | undefined
  const later = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => saveBounds(win), 400)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('close', () => {
    clearTimeout(timer)
    saveBounds(win)
  })
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
