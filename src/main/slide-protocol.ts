import * as path from 'path'

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

/** True when `file` resolves to a location strictly inside `root`. */
export function isInside(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
