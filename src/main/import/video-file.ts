import fs from 'node:fs'
import path from 'node:path'
import { VIDEO_EXTENSIONS_RE } from '../../shared/video-file'
import type { FolderDeck } from './folder'

/** A poster frame taken from a video: the PNG bytes and the video's own pixel size. */
export interface PosterGrab {
  png: Buffer
  width: number
  height: number
}

/** Takes a poster frame from `file`; injected so `readVideoDeck` is testable without Electron. */
export type GrabPoster = (file: string) => Promise<PosterGrab>

export const VIDEO_CANNOT_PLAY =
  'This video cannot be played by Bridgecast. Export it as H.264 MP4 or WebM, then add it again.'

const EMPTY = 'This video file is empty. Choose another file.'
const UNREADABLE = 'Could not read this video file. Check that it still exists, then add it again.'

/**
 * Reads one video file as a deck with a single video slide: the poster comes from `grab`
 * (a hidden Electron window in production, a stub in tests), so a video Chromium cannot
 * decode is refused here instead of failing on the output.
 */
export async function readVideoDeck(
  file: string,
  outDir: string,
  grab: GrabPoster
): Promise<FolderDeck> {
  if (!VIDEO_EXTENSIONS_RE.test(file)) throw new Error(VIDEO_CANNOT_PLAY)
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    throw new Error(UNREADABLE)
  }
  if (size === 0) throw new Error(EMPTY)
  let poster: PosterGrab
  try {
    poster = await grab(file)
  } catch (err) {
    if (err instanceof Error && (err.message === EMPTY || err.message === UNREADABLE)) throw err
    throw new Error(VIDEO_CANNOT_PLAY)
  }
  if (poster.width <= 0 || poster.height <= 0) throw new Error(VIDEO_CANNOT_PLAY)
  const pngPath = path.join(outDir, 'poster.png')
  fs.writeFileSync(pngPath, poster.png)
  return {
    name: path.basename(file).replace(VIDEO_EXTENSIONS_RE, ''),
    width: poster.width,
    height: poster.height,
    slides: [{ pngPath, notes: '', videoPath: file }]
  }
}
