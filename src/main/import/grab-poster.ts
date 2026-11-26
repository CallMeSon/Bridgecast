import { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import type { GrabPoster, PosterGrab } from './video-file'

/** How long a single poster grab may take before it is refused. */
const TIMEOUT_MS = 10_000

/**
 * Where to take the poster from: 0.1 s in, or 10% of a short clip, whichever is smaller,
 * so a black first frame is skipped. 0 when the duration cannot be used.
 */
export function posterTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(0.1, duration * 0.1)
}

/**
 * Grabs a poster frame from a video file in a hidden window: plays it, seeks near the start,
 * draws the frame to a canvas and returns the PNG plus the video's own size. A file Chromium
 * cannot decode fails here, so a deck that the output cannot play is never created.
 *
 * A `file://` video taints a canvas read back from another origin, so this window runs with
 * `webSecurity: false`; it only ever loads the local file and never remote content.
 */
export const grabPoster: GrabPoster = async (file) => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })
  try {
    return await withTimeout(grab(win, file))
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function grab(win: BrowserWindow, file: string): Promise<PosterGrab> {
  // A window has no document until it loads one; executeJavaScript would never settle.
  await win.loadURL('about:blank')
  const raw = await win.webContents.executeJavaScript(grabSource(file))
  const grab = raw as {
    dataUrl?: string
    width?: number
    height?: number
    duration?: number
  } | null
  if (!grab?.dataUrl || !grab.width || !grab.height) {
    throw new Error('This video cannot be played by Bridgecast.')
  }
  const png = Buffer.from(grab.dataUrl.slice(grab.dataUrl.indexOf(',') + 1), 'base64')
  return { png, width: grab.width, height: grab.height, duration: grab.duration }
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Taking a frame from the video timed out.')),
      TIMEOUT_MS
    )
    work.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/** The page script: load, seek, draw, and return the PNG data URL with the video's size. */
function grabSource(file: string): string {
  return `(async () => {
    const at = (${posterTime.toString()})
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = ${JSON.stringify(pathToFileURL(file).href)}
    document.body.appendChild(v)
    const event = (name) => new Promise((resolve, reject) => {
      v.addEventListener(name, resolve, { once: true })
      v.addEventListener('error', () => reject(new Error('decode failed')), { once: true })
    })
    await event('loadedmetadata')
    const seek = at(v.duration)
    if (seek > 0) {
      v.currentTime = seek
      await event('seeked')
    } else {
      await event('loadeddata')
    }
    const width = v.videoWidth
    const height = v.videoHeight
    if (!width || !height) throw new Error('zero size')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(v, 0, 0, width, height)
    return { dataUrl: canvas.toDataURL('image/png'), width, height, duration: v.duration }
  })()`
}
