import { useCallback, useEffect, useRef, useState } from 'react'
import type { OutputMedia } from '../model'
import type { OutputAudio } from '../output-audio'
import { layerFor, type LayerSpec } from './layers'
import type { StreamSourceKind } from '../stream'
import { StreamLayer } from './StreamLayer'

/** Crossfade length for a 'fade' transition (spec: 250 ms); the CSS animations match. */
export const FADE_MS = 250

interface Layer {
  key: number
  /** null = black (no image). */
  spec: LayerSpec | null
  fade: boolean
  /** Its first frame is ready (image decoded, video loaded), so it can go on screen without a black frame. */
  ready: boolean
  /** A video that failed to load or play: the layer shows its poster instead. */
  failed?: boolean
}

/** What a layer actually puts on screen (a failed video shows its poster image). */
export type ShownMedia = { kind: 'image' | 'video'; url: string } | null

/** How this window captures stream layers (web deck pages) and what it reports. */
export interface StreamOptions {
  canvas: { width: number; height: number }
  fps: number
  /** Bumped per captured id to capture again with a new source id. */
  generation?: (id: string) => number
  /** Each callback also gets what the layer captures: a web page (`tab`) or a slide show (`desktop`). */
  onFrame?: (id: string, source: StreamSourceKind) => void
  onEnded?: (id: string, source: StreamSourceKind) => void
  onFailed?: (id: string, failed: boolean) => void
  /** The layer paused its stream (HOLD, Freeze). */
  onPaused?: (id: string, source: StreamSourceKind) => void
  /** Accessible name of a stream layer (the operator monitor). */
  label?: string
}

interface Props {
  /** What to show; null = black. */
  media: OutputMedia | null
  fade: boolean
  /** Video sound; the Program monitor is always muted. */
  muted: boolean
  /** Audio output device for video (`setSinkId`); '' or missing = the default device. */
  sinkId?: string | null
  /**
   * The output's gain stage. When given, each video's sound goes through it (it
   * also owns the device, so `sinkId` is ignored); without it the video plays as is.
   */
  audio?: OutputAudio
  /** Class of each layer element (absolutely stacked by the caller's CSS). */
  layerClass: string
  /** Extra attributes for a layer's <img> (e.g. elementtiming). */
  imgAttrs?: (key: number, src: string) => Record<string, string>
  /** A layer is now on screen (cut) or fading in; a video once its first frame is presented. */
  onShown?: (key: number, media: ShownMedia) => void
  /**
   * Capture settings for stream media. The stream's sound goes through `audio`
   * when given (output windows); without it the capture is video only.
   */
  stream?: StreamOptions
}

const shownOf = (l: Layer): ShownMedia =>
  !l.spec
    ? null
    : l.spec.kind === 'stream'
      ? { kind: 'video', url: l.spec.poster ?? l.spec.url }
      : l.spec.kind === 'video' && !l.failed
        ? { kind: 'video', url: l.spec.url }
        : { kind: 'image', url: l.spec.poster ?? l.spec.url }

const DEFAULT_CANVAS = { width: 1920, height: 1080 }
const streamCb =
  (
    cb: ((id: string, source: StreamSourceKind) => void) | undefined,
    id: string,
    source: StreamSourceKind
  ) =>
  (): void =>
    cb?.(id, source)

/**
 * Longest a video layer may stay pending (neither `loadeddata` nor `error`)
 * before it gives up and shows its poster, so a stuck load never keeps the
 * previous slide, or the HDMI window's first show, waiting forever.
 */
export const PENDING_VIDEO_MS = 3000

/** Longest wait for a revealed video's first frame on screen before the layers under it go. */
const FIRST_FRAME_MS = 500

/**
 * Resolves once `v` has a frame on screen (requestVideoFrameCallback), or after
 * FIRST_FRAME_MS. `loadeddata` alone is not enough: the compositor can still
 * be a frame behind, and that frame would be the empty (black) layer.
 */
function framePresented(v: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, FIRST_FRAME_MS)
    v.requestVideoFrameCallback?.(() => {
      clearTimeout(t)
      resolve()
    })
  })
}

/**
 * Routes `v` to audio output `sinkId` ('' = default). A failure (device gone,
 * not allowed) is logged and the video keeps playing on the default device.
 */
function applySink(v: HTMLVideoElement, sinkId: string): void {
  const el = v as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }
  el.setSinkId?.(sinkId).catch((e: unknown) =>
    console.warn(`[video] audio device could not be used, playing on the default device:`, e)
  )
}

/** Stops a video element and releases its media (it is about to be removed). */
function stop(v: HTMLVideoElement): void {
  v.pause()
  v.removeAttribute('src')
  v.load()
}

/**
 * Stacked slide layers for Program. A new slide is added on top but stays
 * invisible (`data-state="pending"`) until its own first frame is ready (an
 * <img> decoded, a <video> at `loadeddata`); only then is it cut in or faded in
 * over the previous slide, which is removed afterwards. So Next never shows a
 * black frame between two slides, neither with Cut nor with Fade. The first
 * layer is always a cut.
 *
 * A video starts playing when it is revealed and holds its last frame at the
 * end. Each take plays once per window: coming back to a take already played
 * (after Black or KV) shows its poster, the last frame (see `layerFor`). A
 * newer slide supersedes any layer still pending: that layer is stopped and
 * removed at once, so it never shows or sounds.
 *
 * `fit` is a property of a layer, not part of its identity: when only the fit
 * of the media on top changes, the layer's `data-fit` is updated in place.
 */
export function SlideLayers({
  media,
  fade,
  muted,
  sinkId,
  audio,
  layerClass,
  imgAttrs,
  onShown,
  stream
}: Props): React.JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([])
  // Mirror of `layers` so reveal/drop can compute the next list synchronously.
  const current = useRef<Layer[]>([])
  const videos = useRef(new Map<number, HTMLVideoElement>())
  const audioRef = useRef(audio)
  useEffect(() => {
    audioRef.current = audio
  })
  /** Pending-timeout of each video layer that is not yet revealed. */
  const pendingTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const clearPending = useCallback((key: number) => {
    const t = pendingTimers.current.get(key)
    if (t !== undefined) clearTimeout(t)
    pendingTimers.current.delete(key)
  }, [])
  const commit = useCallback(
    (next: Layer[]) => {
      // Videos of removed layers are stopped first (never heard or seen again).
      const keep = new Set(next.map((l) => l.key))
      for (const [key, v] of videos.current) {
        if (!keep.has(key)) {
          audioRef.current?.detach(v)
          stop(v)
          videos.current.delete(key)
        }
      }
      for (const key of [...pendingTimers.current.keys()]) if (!keep.has(key)) clearPending(key)
      current.current = next
      setLayers(next)
    },
    [clearPending]
  )
  const seq = useRef(0)
  /** Id of the newest layer (undefined before the first one; null = black). */
  const topId = useRef<string | null | undefined>(undefined)
  /** Takes this window has put on screen as video. */
  const played = useRef(new Set<number>())
  const decoding = useRef(new Set<number>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const shown = useRef(onShown)
  useEffect(() => {
    shown.current = onShown
  })

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const pending = timers.current
    const vids = videos.current
    const loading = pendingTimers.current
    return () => {
      alive.current = false
      pending.forEach(clearTimeout)
      loading.forEach(clearTimeout)
      loading.clear()
      vids.forEach((v) => {
        audioRef.current?.detach(v)
        stop(v)
      })
    }
  }, [])

  /** Marks a video layer as failed: it shows (and is revealed with) its poster. */
  const fail = useCallback(
    (key: number, why: unknown) => {
      const ls = current.current
      const l = ls.find((x) => x.key === key)
      if (!l || l.failed) return
      console.error(`[video] ${l.spec?.url} failed, showing its poster:`, why)
      clearPending(key)
      // A load that is still going on is dropped with it.
      const v = videos.current.get(key)
      if (v) stop(v)
      commit(ls.map((x) => (x.key === key ? { ...x, failed: true } : x)))
    },
    [commit, clearPending]
  )

  const reveal = useCallback(
    (key: number) => {
      const ls = current.current
      const i = ls.findIndex((l) => l.key === key)
      if (i < 0 || ls[i].ready) return
      clearPending(key)
      // Keep only the newest visible layer underneath (the one to fade from);
      // older or superseded pending layers below are dropped.
      const below = ls.slice(0, i).filter((l) => l.ready)
      const prev = below[below.length - 1]
      const layer = { ...ls[i], ready: true }
      commit([...(prev ? [{ ...prev, fade: false }] : []), layer, ...ls.slice(i + 1)])
      const v = videos.current.get(key)
      let covers = Promise.resolve()
      if (layer.spec?.kind === 'video' && !layer.failed && v) {
        played.current.add(layer.spec.take ?? -1)
        v.play().catch((e: unknown) => fail(key, e))
        // A video layer is see-through (CSS) until its first frame is on screen,
        // so the slide underneath stays visible until then, never a black frame.
        covers = framePresented(v)
      }
      // Drop what is underneath once the new layer fully covers it.
      void covers.then(() => {
        if (!alive.current) return
        // On screen now (a video with its first frame), e.g. for `outputReady`.
        shown.current?.(layer.key, shownOf(layer))
        const t = setTimeout(
          () => {
            timers.current.delete(t)
            commit(current.current.filter((l) => l.key >= key))
          },
          layer.fade ? FADE_MS + 50 : 50
        )
        timers.current.add(t)
      })
    },
    [commit, fail, clearPending]
  )

  // A stable key for `media` (callers build a new object on every render).
  const mediaKey = media ? JSON.stringify(media) : null
  useEffect(() => {
    const m = mediaKey ? (JSON.parse(mediaKey) as OutputMedia) : null
    const spec = layerFor(m, played.current, topId.current ?? null)
    const id = spec?.id ?? null
    if (id === topId.current) {
      // Same media, another fit (the deck's Fit changed while it is live): update
      // that layer in place. No new layer, no fade, and a <video> stays the same
      // element, so it keeps playing.
      const ls = current.current
      const i = ls.map((l) => l.spec?.id ?? null).lastIndexOf(id)
      const at = i >= 0 ? ls[i].spec : null
      // A stream's poster (new snapshot) and pause (Freeze, HOLD) also change in place.
      if (
        spec &&
        at &&
        (at.fit !== spec.fit || at.poster !== spec.poster || at.paused !== spec.paused)
      ) {
        const next = { ...at, fit: spec.fit, poster: spec.poster, paused: spec.paused }
        commit(ls.map((l, j) => (j === i ? { ...l, spec: next } : l)))
      }
      return
    }
    const first = topId.current === undefined
    topId.current = id
    const key = ++seq.current
    // Pending layers are superseded by this one: they are stopped and removed now.
    commit([
      ...current.current.filter((l) => l.ready),
      { key, spec, fade: fade && !first, ready: false }
    ])
    // Black needs no decoding.
    if (spec === null) reveal(key)
  }, [mediaKey, fade, reveal, commit])

  /** Decodes the layer's own <img> (a preload elsewhere does not help this element). */
  const decode = (key: number) => (img: HTMLImageElement | null) => {
    if (!img || decoding.current.has(key)) return
    decoding.current.add(key)
    // A broken image must still replace the old slide; it then shows as black.
    void img
      .decode()
      .catch(() => undefined)
      .then(() => reveal(key))
  }

  // The sink each video element was last routed to (a new element is on the default).
  const sinks = useRef(new WeakMap<HTMLVideoElement, string>())
  const sink = sinkId ?? ''
  const route = useCallback((v: HTMLVideoElement, id: string) => {
    if (audioRef.current) return // the gain stage owns the device
    if ((sinks.current.get(v) ?? '') === id) return
    sinks.current.set(v, id)
    applySink(v, id)
  }, [])
  // A device change reaches the videos already playing, too.
  useEffect(() => {
    videos.current.forEach((v) => route(v, sink))
  }, [sink, route])

  /** Starts the pending timeout of a video layer that is not revealed yet (once). */
  const armPending = (key: number): void => {
    const l = current.current.find((x) => x.key === key)
    if (!l || l.ready || l.failed || pendingTimers.current.has(key)) return
    pendingTimers.current.set(
      key,
      setTimeout(() => {
        pendingTimers.current.delete(key)
        fail(key, `no first frame within ${PENDING_VIDEO_MS} ms`)
      }, PENDING_VIDEO_MS)
    )
  }

  const videoRef = (key: number) => (v: HTMLVideoElement | null) => {
    if (!v) return
    videos.current.set(key, v)
    audio?.attach(v)
    route(v, sink)
    armPending(key)
  }

  return (
    <>
      {layers.map((l) => (
        <div
          key={l.key}
          className={layerClass}
          data-state={!l.ready ? 'pending' : l.fade ? 'fade' : 'shown'}
          data-kind={
            l.spec?.kind === 'stream'
              ? 'stream'
              : l.spec?.kind === 'video' && !l.failed
                ? 'video'
                : undefined
          }
          data-fit={l.spec?.fit}
        >
          {l.spec?.kind === 'stream' && l.spec.source && l.spec.deckId ? (
            <StreamLayer
              source={l.spec.source}
              id={l.spec.deckId}
              poster={l.spec.poster ?? l.spec.url}
              paused={!!l.spec.paused}
              canvas={stream?.canvas ?? DEFAULT_CANVAS}
              fps={stream?.fps ?? 30}
              audio={audio}
              muted={muted}
              generation={stream?.generation?.(l.spec.deckId) ?? 0}
              onReady={() => reveal(l.key)}
              onFrame={streamCb(stream?.onFrame, l.spec.deckId, l.spec.source)}
              onEnded={streamCb(stream?.onEnded, l.spec.deckId, l.spec.source)}
              onFailed={(f) => stream?.onFailed?.(l.spec?.deckId ?? '', f)}
              onPaused={streamCb(stream?.onPaused, l.spec.deckId, l.spec.source)}
              label={stream?.label}
            />
          ) : l.spec?.kind === 'video' && !l.failed ? (
            <video
              src={l.spec.url}
              muted={muted}
              // Sound through Web Audio is silent for a cross-origin video without CORS.
              crossOrigin={audio ? 'anonymous' : undefined}
              playsInline
              preload="auto"
              ref={videoRef(l.key)}
              onLoadedData={() => reveal(l.key)}
              onError={(e) => {
                const err = e.currentTarget.error
                fail(l.key, err?.message || `media error ${err?.code ?? '?'}`)
              }}
            />
          ) : (
            l.spec && (
              <img
                src={l.spec.poster ?? l.spec.url}
                alt=""
                draggable={false}
                ref={decode(l.key)}
                {...imgAttrs?.(l.key, l.spec.poster ?? l.spec.url)}
              />
            )
          )}
        </div>
      ))}
    </>
  )
}
