import * as path from 'path'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INDEX_RE = /^\/(\d{1,5})\.png$/

/** Parse `slide://<deckId>/<index>.png`; returns null for anything else. */
export function parseSlideUrl(url: string): { deckId: string; index: number } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'slide:' || u.search || u.username || u.port) return null
  const deckId = u.hostname
  if (!UUID_RE.test(deckId)) return null
  const m = INDEX_RE.exec(u.pathname)
  if (!m) return null
  return { deckId: deckId.toLowerCase(), index: Number(m[1]) }
}

/** True when `file` resolves to a location strictly inside `root`. */
export function isInside(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
