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
