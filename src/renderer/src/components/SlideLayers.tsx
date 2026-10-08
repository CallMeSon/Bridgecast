import { useCallback, useEffect, useRef, useState } from 'react'

/** Crossfade length for a 'fade' transition (spec: 250 ms); the CSS animations match. */
export const FADE_MS = 250

interface Layer {
  key: number
  /** null = black (no image). */
  src: string | null
  fade: boolean
  /** Its image is decoded, so it can go on screen without a black frame. */
  ready: boolean
}

interface Props {
  /** Image to show; null = black. */
  src: string | null
  fade: boolean
  /** Class of each layer element (absolutely stacked by the caller's CSS). */
  layerClass: string
  /** Extra attributes for a layer's <img> (e.g. elementtiming). */
  imgAttrs?: (key: number) => Record<string, string>
  /** A layer is now on screen (cut) or fading in. */
  onShown?: (key: number, src: string | null) => void
}

/**
 * Stacked slide layers for Program. A new slide is added on top but stays
 * invisible (`data-state="pending"`) until its own <img> is decoded; only
 * then is it cut in or faded in over the previous slide, which is removed
 * afterwards. So Next never shows a black frame between two slides, neither
 * with Cut nor with Fade. The first layer is always a cut.
 */
export function SlideLayers({
  src,
  fade,
  layerClass,
  imgAttrs,
  onShown
}: Props): React.JSX.Element {
  const [layers, setLayers] = useState<Layer[]>([])
  // Mirror of `layers` so reveal/drop can compute the next list synchronously.
  const current = useRef<Layer[]>([])
  const commit = useCallback((next: Layer[]) => {
    current.current = next
    setLayers(next)
  }, [])
  const seq = useRef(0)
  const topSrc = useRef<string | null | undefined>(undefined)
  const decoding = useRef(new Set<number>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const shown = useRef(onShown)
  useEffect(() => {
    shown.current = onShown
  })

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const reveal = useCallback(
    (key: number) => {
      const ls = current.current
      const i = ls.findIndex((l) => l.key === key)
      if (i < 0 || ls[i].ready) return
      // Keep only the newest visible layer underneath (the one to fade from);
      // older or superseded pending layers below are dropped.
      const below = ls.slice(0, i).filter((l) => l.ready)
      const prev = below[below.length - 1]
      const layer = { ...ls[i], ready: true }
      commit([...(prev ? [{ ...prev, fade: false }] : []), layer, ...ls.slice(i + 1)])
      shown.current?.(layer.key, layer.src)
      // Drop what is underneath once the new layer fully covers it.
      const t = setTimeout(
        () => {
          timers.current.delete(t)
          commit(current.current.filter((l) => l.key >= key))
        },
        layer.fade ? FADE_MS + 50 : 50
      )
      timers.current.add(t)
    },
    [commit]
  )

  useEffect(() => {
    if (src === topSrc.current) return
    const first = topSrc.current === undefined
    topSrc.current = src
    const key = ++seq.current
    commit([...current.current, { key, src, fade: fade && !first, ready: false }])
    // Black needs no decoding.
    if (src === null) reveal(key)
  }, [src, fade, reveal, commit])

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

  return (
    <>
      {layers.map((l) => (
        <div
          key={l.key}
          className={layerClass}
          data-state={!l.ready ? 'pending' : l.fade ? 'fade' : 'shown'}
        >
          {l.src && (
            <img src={l.src} alt="" draggable={false} ref={decode(l.key)} {...imgAttrs?.(l.key)} />
          )}
        </div>
      ))}
    </>
  )
}
