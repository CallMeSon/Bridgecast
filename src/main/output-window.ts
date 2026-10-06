import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export interface OutputOptions {
  width: number
  height: number
  fps: number
}

/** Settings defaults (spec: 1920×1080, 30 fps). Task 8 replaces this with saved settings. */
export const OUTPUT_DEFAULTS: OutputOptions = { width: 1920, height: 1080, fps: 30 }

/**
 * Hidden offscreen window rendering the renderer's `#/output` route. Every
 * `paint` hands the whole frame (BGRA on Windows, width*height*4 bytes) to
 * `onFrame`. Chromium only paints when something changes, so callers feed the
 * frames into a FrameRepeater to keep a constant frame rate.
 */
export function createOutputWindow(
  opts: OutputOptions,
  onFrame: (frame: Buffer) => void
): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: opts.width,
    height: opts.height,
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
  win.setContentSize(opts.width, opts.height)

  const wc = win.webContents
  wc.setFrameRate(opts.fps)
  // Offscreen frames are rendered at the display's scale factor: at 112 %
  // Windows scaling a 1920×1080 window paints 2152×1211 (and the window itself
  // rounds to 1921×1081 DIP). Neither setZoomFactor nor device emulation
  // changes the bitmap size, so such frames are downscaled to exactly
  // width×height here; at 100 % scaling the bitmap is used as is.
  // toBitmap() is the non-deprecated name of getBitmap() (BGRA on Windows).
  let warned = false
  wc.on('paint', (_e, _dirty, image) => {
    if (image.isEmpty()) return
    const size = image.getSize()
    if (size.width === opts.width && size.height === opts.height) {
      onFrame(image.toBitmap())
      return
    }
    if (!warned) {
      warned = true
      console.log(
        `[output] frame ${size.width}×${size.height} (skala layar) diskalakan ke ${opts.width}×${opts.height}`
      )
    }
    onFrame(image.resize({ width: opts.width, height: opts.height, quality: 'good' }).toBitmap())
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
