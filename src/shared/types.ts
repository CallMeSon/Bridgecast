import type { Canvas, DeckFit } from './canvas'
import type { DeckAudio } from './audio-levels'

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
  /** How slides fill the canvas; absent = 'fit'. */
  fit?: DeckFit
  /** Sound level of this deck's videos; absent = full volume, not muted. */
  audio?: DeckAudio
}

export interface SectionMeta {
  id: string
  name: string
  /** The section starts before deckIds[at]; at === deckIds.length means it is last and empty. */
  at: number
}

export interface EventMeta {
  id: string
  name: string
  deckIds: string[]
  /** Dividers over deckIds: a section starts before deckIds[at]. Absent = no sections. */
  sections?: SectionMeta[]
  /** File name of the event's KV (key visual) image, if any (see Library.setKv). */
  kv?: string
  /** Output canvas for this event; absent = the machine default. */
  canvas?: Canvas
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
