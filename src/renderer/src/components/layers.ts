import type { OutputMedia } from '../model'

/** One slide layer to put on screen; `id` tells whether it is a new layer. */
export interface LayerSpec {
  id: string
  kind: 'image' | 'video'
  url: string
  poster?: string
  take?: number
}

/**
 * The layer for `media` in one window. A video plays once per take: a take
 * this window already played (`played`) comes back as its poster (the last
 * frame), e.g. after Black or KV, unless that video layer is still on top
 * (`topId`), where it stays as it is. A new take is a new video layer.
 */
export function layerFor(
  media: OutputMedia | null,
  played: ReadonlySet<number>,
  topId: string | null
): LayerSpec | null {
  if (!media) return null
  if (media.kind === 'image') return { id: media.url, kind: 'image', url: media.url }
  const id = `v:${media.url}#${media.take}`
  if (played.has(media.take) && id !== topId) {
    return { id: media.poster, kind: 'image', url: media.poster }
  }
  return { id, kind: 'video', url: media.url, poster: media.poster, take: media.take }
}
