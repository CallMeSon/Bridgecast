import type { DeckFit } from '../../../shared/canvas'
import type { MediaClock } from '../../../shared/media'
import type { OutputMedia } from '../model'
import type { StreamSourceKind } from '../stream'

/** One slide layer to put on screen; `id` tells whether it is a new layer. */
export interface LayerSpec {
  id: string
  kind: 'image' | 'video' | 'stream' | 'pdf'
  url: string
  poster?: string
  take?: number
  /** PDF layers: 1-based page of `url`. */
  page?: number
  /** Stream layers: what is captured, and whether the last frame is held. */
  source?: StreamSourceKind
  deckId?: string
  paused?: boolean
  /** Video layers of a media deck: the shared clock (updates in place, not part of `id`). */
  clock?: MediaClock
  /** How the media fills the stage; changing it never makes a new layer (not part of `id`). */
  fit: DeckFit
}

/**
 * The layer for `media` in one window. A video plays once per take: a take
 * this window already played (`played`) comes back as its poster (the last
 * frame), e.g. after Black or KV, unless that video layer is still on top
 * (`topId`), where it stays as it is. A new take is a new video layer. The
 * deck's `fit` is copied but is not part of the id: a fit change keeps the layer.
 * A stream is one layer per source and take (per deck for a slide show window): its poster and pause change in
 * place; it is live, so it never turns into its poster (it is captured again).
 * The captured page has the canvas size, so it fills the stage (`stretch`).
 */
export function layerFor(
  media: OutputMedia | null,
  played: ReadonlySet<number>,
  topId: string | null
): LayerSpec | null {
  if (!media) return null
  if (media.kind === 'image')
    return { id: media.url, kind: 'image', url: media.url, fit: media.fit }
  // One layer per page: a page change is a new layer, so it reveals (and fades) like an image.
  if (media.kind === 'pdf') {
    return {
      id: `p:${media.url}#${media.page}`,
      kind: 'pdf',
      url: media.url,
      page: media.page,
      poster: media.poster,
      fit: media.fit
    }
  }
  if (media.kind === 'stream') {
    return {
      // A slide show window is one capture for the whole deck (its slides change the poster
      // in place); a web page is one capture per take.
      id:
        media.source === 'desktop'
          ? `s:desktop:${media.deckId}`
          : `s:${media.source}:${media.deckId}#${media.take}`,
      kind: 'stream',
      source: media.source,
      deckId: media.deckId,
      url: media.poster,
      poster: media.poster,
      paused: media.paused,
      take: media.take,
      fit: 'stretch'
    }
  }
  const id = `v:${media.url}#${media.take}`
  // A clocked video (media deck) is never swapped for its poster: the operator controls it.
  if (played.has(media.take) && id !== topId && !media.clock) {
    return { id: media.poster, kind: 'image', url: media.poster, fit: media.fit }
  }
  return {
    id,
    kind: 'video',
    url: media.url,
    poster: media.poster,
    take: media.take,
    fit: media.fit,
    ...(media.clock ? { clock: media.clock } : {})
  }
}
