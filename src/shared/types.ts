/** Longest deck name accepted when renaming, in code points. */
export const DECK_NAME_MAX = 120

export interface SlideMeta {
  file: string
  notes: string
  video?: string
}

export interface DeckMeta {
  id: string
  name: string
  source: 'pptx' | 'pdf' | 'folder'
  width: number
  height: number
  slides: SlideMeta[]
}

export interface EventMeta {
  id: string
  name: string
  deckIds: string[]
  /** File name of the event's KV (key visual) image, if any (see Library.setKv). */
  kv?: string
}

/** Largest KV image accepted, in bytes (50 MB). */
export const KV_MAX_BYTES = 50 * 1024 * 1024

/** MIME type per KV file extension (lowercase, without the dot). */
export const KV_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

/** Stored KV file names are `<uuid>.<ext>` (see Library.setKv). */
export const KV_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$/
