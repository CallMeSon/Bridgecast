import { useEffect, useRef, useState } from 'react'
import type { DeckFit } from '../../../shared/canvas'
import { showPdfPage } from './pdf-page'
import { acquirePdf, releasePdf, renderPdfPage, type PdfEntry } from './pdf-doc'

interface Props {
  url: string
  /** 1-based page of the document. */
  page: number
  /** The slide's PNG, shown instead when pdf.js cannot draw the page. */
  poster: string
  fit: DeckFit
  /** The page is drawn (or the poster takes over): the layer can go on screen. */
  onReady: () => void
}

/**
 * One page of a deck's source.pdf, vector-drawn into a canvas sized for this layer's box
 * at the device pixel ratio. The document is loaded once per deck and shared by the
 * layers (and released with the last one). After drawing, the next page is rendered
 * ahead into the document's cache, so the next layer is ready at once. A page that
 * cannot be drawn shows the PNG poster and logs the error; the other pages stay vector.
 */
export function PdfLayer({ url, page, poster, fit, onReady }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const ready = useRef(onReady)
  useEffect(() => {
    ready.current = onReady
  })
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0)
        setSize((s) => (s && s.width === w && s.height === h ? s : { width: w, height: h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The shared document: held for the life of the layer, not per render (a resize must not reload it).
  const held = useRef<PdfEntry | null>(null)
  useEffect(() => {
    const e = acquirePdf(url)
    held.current = e
    return () => {
      held.current = null
      releasePdf(e)
    }
  }, [url])

  useEffect(() => {
    const entry = held.current
    if (!size || !entry) return
    const dpr = window.devicePixelRatio || 1
    return showPdfPage(
      {
        render: () => renderPdfPage(entry, page, size, fit, dpr),
        onDrawn: (src) => {
          const dst = canvas.current
          if (!dst) return
          dst.width = src.width
          dst.height = src.height
          dst.getContext('2d')?.drawImage(src, 0, 0)
          setFailed(false)
          // Next page ahead, off screen; a failure there surfaces when that page is shown.
          renderPdfPage(entry, page + 1, size, fit, dpr).catch(() => undefined)
        },
        onFailed: () => setFailed(true),
        onReady: () => ready.current()
      },
      `${url} page ${page}`
    )
  }, [url, page, fit, size])

  return (
    <div ref={box} className="pdf-box">
      {failed ? (
        <img src={poster} alt="" draggable={false} />
      ) : (
        <canvas ref={canvas} aria-hidden="true" />
      )}
    </div>
  )
}
