import * as path from 'path'
import { KV_FILE_RE, KV_MIME } from '../shared/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Slide files are `001.png`, `002.png`, ... (see Library). */
const FILE_RE = /^\/(\d{3,6}\.png)$/

/**
 * Parse `slide://<deckId>/<file>` (e.g. `slide://<uuid>/003.png`); returns
 * null for anything else. The URL names the slide's image file, not its
 * position, so it never points at another image after a reorder.
 */
export function parseSlideUrl(url: string): { deckId: string; file: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'slide:' || u.search || u.hash || u.username || u.port) return null
  const deckId = u.hostname
  if (!UUID_RE.test(deckId)) return null
  const m = FILE_RE.exec(u.pathname)
  if (!m) return null
  return { deckId: deckId.toLowerCase(), file: m[1] }
}

/**
 * Parse `slide://kv/<eventId>/<file>` (the event's KV image, e.g.
 * `slide://kv/<uuid>/<uuid>.png`); null for anything else. Deck URLs have a
 * uuid host, so `kv` can never clash with them.
 */
export function parseKvUrl(url: string): { eventId: string; file: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'slide:' || u.hostname !== 'kv') return null
  if (u.search || u.hash || u.username || u.password || u.port) return null
  const parts = u.pathname.split('/') // ['', eventId, file]
  if (parts.length !== 3 || parts[0] !== '') return null
  const [, eventId, file] = parts
  if (!UUID_RE.test(eventId) || !KV_FILE_RE.test(file)) return null
  return { eventId: eventId.toLowerCase(), file }
}

/** Thumbnails: `/thumbs/001.jpg`. */
const THUMB_RE = /^\/thumbs\/(\d{3,6})\.jpg$/

/**
 * Parse `slide://<deckId>/thumbs/<n>.jpg` (small strip thumbnail of slide
 * `<n>.png`); returns the deck id and the slide file (`<n>.png`), or null for
 * anything else. Same strict rules as parseSlideUrl.
 */
export function parseThumbUrl(url: string): { deckId: string; file: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'slide:' || u.search || u.hash || u.username || u.password || u.port) {
    return null
  }
  if (!UUID_RE.test(u.hostname)) return null
  const m = THUMB_RE.exec(u.pathname)
  if (!m) return null
  return { deckId: u.hostname.toLowerCase(), file: `${m[1]}.png` }
}

/** Thumbnail file name of a slide file (`003.png` -> `003.jpg`). */
export function thumbFileName(slideFile: string): string {
  return slideFile.replace(/\.png$/i, '.jpg')
}

/** Content-type of a KV file by its extension; null when it is not an allowed image. */
export function kvMimeType(file: string): string | null {
  const ext = path.extname(file).slice(1).toLowerCase()
  return Object.prototype.hasOwnProperty.call(KV_MIME, ext) ? KV_MIME[ext] : null
}

/** True when `file` resolves to a location strictly inside `root`. */
export function isInside(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
