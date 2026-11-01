import type { Canvas, DeckFit } from './canvas'
import type { DeckAudio } from './audio-levels'

/** Longest deck name accepted when renaming, in code points. */
export const DECK_NAME_MAX = 120

export interface SlideMeta {
  file: string
  notes: string
  video?: string
  /** Click animations (on-click effects) on this slide; absent = 0. */
  clicks?: number
  /** The slide is hidden in PowerPoint; absent = shown. */
  hidden?: boolean
}

/** How a deck plays: PowerPoint itself, vector pages from the PDF, or the slide images. */
export type Playback = 'native' | 'vector' | 'images'

export interface DeckMeta {
  id: string
  name: string
  source: 'pptx' | 'pdf' | 'folder' | 'web'
  width: number
  height: number
  slides: SlideMeta[]
  /** How slides fill the canvas; absent = 'fit'. */
  fit?: DeckFit
  /** Sound level of this deck's videos; absent = full volume, not muted. */
  audio?: DeckAudio
  /** How the deck plays; absent = 'images'. */
  playback?: Playback
  /**
   * The deck had no animation, transition or media when its file was last imported or re-imported
   * (`ImportedDeck.isStatic`). Absent on older decks. Lets an edit switch the import default
   * `vector` to `native` without touching a mode the operator chose.
   */
  importStatic?: boolean
  /** The page of a web deck (source 'web'). */
  web?: { url: string; zoom?: number }
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
  /** Creation time, ms since epoch; absent on events made before this field existed. */
  createdAt?: number
  /** Last time the operator opened the event, ms since epoch. */
  lastOpened?: number
  /** Hidden from Recent; absent = not archived (never stored as false). */
  archived?: true
}

/** What Home needs to draw an event card. */
export interface EventSummary {
  id: string
  deckCount: number
  deckNames: string[]
  hasWeb: boolean
  /** First slide of the first deck that has one (a web deck's snapshot counts). */
  first: { deckId: string; file: string; web: boolean } | null
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
