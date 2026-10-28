import type { DeckMeta, Playback } from './types'

/** Mode a new deck starts in: static PowerPoint and PDF play as vector pages, animated PowerPoint natively. */
export function defaultPlayback(source: DeckMeta['source'], isStatic: boolean): Playback {
  if (source === 'pptx') return isStatic ? 'vector' : 'native'
  if (source === 'pdf') return 'vector'
  return 'images'
}

/** The deck's mode; decks saved before playback existed play as images. */
export function playbackOf(d: DeckMeta): Playback {
  return isPlayback(d.playback) ? d.playback : 'images'
}

/** Only PowerPoint decks can play natively. */
export function canNative(d: DeckMeta): boolean {
  return d.source === 'pptx'
}

export function isPlayback(v: unknown): v is Playback {
  return v === 'native' || v === 'vector' || v === 'images'
}

/** State of a native deck's slide show session. */
export type EngineState = 'opening' | 'ready' | 'fallback'

/** What the operator window learns about the native slide shows (`slideshow:status`). */
export interface SlideshowStatus {
  /** Per native deck. */
  decks: Record<string, EngineState>
  /** Decks that fell back to stills and whose slide show session is open again (Resume works). */
  resumable: string[]
  /** The helper could not start (operator copy), or null. */
  helperError: string | null
}

/**
 * Session state of every native deck: ready when its slide show is open, fallback when the
 * engine failed while the deck was on air (until resumed), else still opening.
 */
export function engineStates(
  decks: DeckMeta[],
  engine: { ready(deckId: string): boolean; fellBack(deckId: string): boolean }
): Record<string, EngineState> {
  const out: Record<string, EngineState> = {}
  for (const d of decks) {
    if (playbackOf(d) !== 'native') continue
    out[d.id] = engine.fellBack(d.id) ? 'fallback' : engine.ready(d.id) ? 'ready' : 'opening'
  }
  return out
}
