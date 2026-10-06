import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { cropOrPad, dipSize, fitMode, tolerance, type FitMode, type Size } from './output-geometry'

export interface OutputOptions {
  width: number
  height: number
  fps: number
}

/** Per-paint processing measurements (read by the dev/e2e debug hook). */
export interface PaintStats {
  scaleFactor: number
  windowDip: Size
  painted: Size | null
  mode: FitMode | null
  count: number
  totalMs: number
  maxMs: number
}

/**
 * Hidden offscreen window rendering the renderer's `#/output` route. Every
 * `paint` hands the whole frame (BGRA on Windows, width*height*4 bytes) to
 * `onFrame`. Chromium only paints when something changes, so callers feed the
 * frames into a FrameRepeater to keep a constant frame rate.
 */
export function createOutputWindow(
  opts: OutputOptions,
  onFrame: (frame: Buffer) => void,
  stats?: PaintStats
): BrowserWindow {
  // Offscreen windows paint at the display scale factor (at 112 % a 1920×1080
  // DIP window paints 2152×1211) and Electron 39 has no per-window override;
  // zoom and device emulation do not change the bitmap size. So the window is
  // sized in DIP = target / scaleFactor: Chromium then rasterizes the slide at
  // ≈ target device pixels, with no up- then down-sampling.
  const sf = screen.getPrimaryDisplay().scaleFactor
  const dip = dipSize(opts.width, opts.height, sf)
  const tol = tolerance(sf)
  const target = { width: opts.width, height: opts.height }
  if (stats) {
    Object.assign(stats, { scaleFactor: sf, windowDip: dip, painted: null, mode: null })
    Object.assign(stats, { count: 0, totalMs: 0, maxMs: 0 })
  }

  const win = new BrowserWindow({
    show: false,
    width: dip.width,
    height: dip.height,
    useContentSize: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#000000',
    title: 'PPT Share Output',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  // A window can be clamped to the screen size on creation; the offscreen
  // surface follows the content size, so set it explicitly.
  win.setContentSize(dip.width, dip.height)

  const wc = win.webContents
  wc.setFrameRate(opts.fps)
  // Windows may still round the window by a DIP (112 %: 1714 asked, 1715
  // given → 1921 px), so small mismatches are cropped/padded with black. Only
  // a large mismatch (scale factor changed under us) is resampled.
  // toBitmap() is the non-deprecated name of getBitmap() (BGRA on Windows).
  let warned = false
  wc.on('paint', (_e, _dirty, image) => {
    if (image.isEmpty()) return
    const t0 = performance.now()
    const size = image.getSize()
    const mode = fitMode(size, target, tol)
    let frame: Buffer
    if (mode === 'exact') {
      frame = image.toBitmap()
    } else if (mode === 'cropPad') {
      frame = cropOrPad(image.toBitmap(), size.width, size.height, opts.width, opts.height)
    } else {
      if (!warned) {
        warned = true
        console.log(
          `[output] frame ${size.width}×${size.height} diskalakan ke ${opts.width}×${opts.height} (skala layar ${sf})`
        )
      }
      frame = image.resize({ width: opts.width, height: opts.height, quality: 'best' }).toBitmap()
    }
    if (stats) {
      const ms = performance.now() - t0
      stats.painted = size
      stats.mode = mode
      stats.count++
      stats.totalMs += ms
      stats.maxMs = Math.max(stats.maxMs, ms)
    }
    onFrame(frame)
  })

  // Output only: no keyboard/mouse input, no navigation, no popups.
  wc.on('before-input-event', (e) => e.preventDefault())
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/output`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/output' })
  }
  return win
}
