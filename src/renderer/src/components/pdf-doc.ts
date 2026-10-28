// Same legacy build and bundled worker as the importer (see ../import/pdf.ts).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { DeckFit } from '../../../shared/canvas'
import { pdfRenderSize } from '../pdf-render'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Rendered pages kept per document (current, next and a step back). */
const KEEP_PAGES = 4

export interface PdfEntry {
  url: string
  refs: number
  task: pdfjs.PDFDocumentLoadingTask
  doc: Promise<pdfjs.PDFDocumentProxy>
  /** Rendered pages by `page:width x height`, oldest first. */
  pages: Map<string, Promise<HTMLCanvasElement>>
  renders: Set<pdfjs.RenderTask>
  closed: boolean
}

const entries = new Map<string, PdfEntry>()

/** One loaded document per URL (deck); every `acquirePdf` needs a matching `releasePdf`. */
export function acquirePdf(url: string): PdfEntry {
  let e = entries.get(url)
  if (!e) {
    const task = pdfjs.getDocument({ url })
    e = {
      url,
      refs: 0,
      task,
      doc: task.promise,
      pages: new Map(),
      renders: new Set(),
      closed: false
    }
    // A failed load surfaces through renderPdfPage; do not leave it unhandled here.
    e.doc.catch(() => undefined)
    entries.set(url, e)
  }
  e.refs++
  return e
}

/** Drops a reference; the last one cancels renders and destroys the document, worker and canvases. */
export function releasePdf(e: PdfEntry): void {
  if (--e.refs > 0) return
  e.closed = true
  entries.delete(e.url)
  e.renders.forEach((r) => r.cancel())
  e.renders.clear()
  for (const p of e.pages.values()) void p.then(freeCanvas, () => undefined)
  e.pages.clear()
  void e.task.destroy().catch(() => undefined)
}

function freeCanvas(c: HTMLCanvasElement): void {
  c.width = 0
  c.height = 0
}

/**
 * The page drawn for a stage of `stage` CSS pixels (cached: asking again, e.g. for the
 * page that was rendered ahead, returns the same canvas). Rejects when pdf.js cannot
 * load or draw it.
 */
export function renderPdfPage(
  e: PdfEntry,
  page: number,
  stage: { width: number; height: number },
  fit: DeckFit,
  dpr: number
): Promise<HTMLCanvasElement> {
  const draw = async (): Promise<HTMLCanvasElement> => {
    const doc = await e.doc
    if (page < 1 || page > doc.numPages) throw new Error(`page ${page} of ${doc.numPages}`)
    const p = await doc.getPage(page)
    const base = p.getViewport({ scale: 1 })
    const size = pdfRenderSize(stage, base, fit, dpr)
    const viewport = p.getViewport({ scale: size.scale })
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d canvas')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size.width, size.height)
    // Rounding (and Stretch) make the viewport differ slightly from the canvas.
    const transform: number[] = [
      size.width / viewport.width,
      0,
      0,
      size.height / viewport.height,
      0,
      0
    ]
    const render = p.render({ canvasContext: ctx, canvas, viewport, transform })
    e.renders.add(render)
    try {
      await render.promise
    } finally {
      e.renders.delete(render)
      p.cleanup()
    }
    return canvas
  }
  const key = `${page}:${Math.round(stage.width)}x${Math.round(stage.height)}:${fit}:${dpr}`
  const hit = e.pages.get(key)
  if (hit) return hit
  const made = draw()
  e.pages.set(key, made)
  made.catch(() => e.pages.delete(key))
  while (e.pages.size > KEEP_PAGES) {
    const [oldest] = e.pages.keys()
    const old = e.pages.get(oldest)
    e.pages.delete(oldest)
    // The oldest page may be on screen in a layer: it keeps its own copy, so free this one.
    void old?.then(freeCanvas, () => undefined)
  }
  return made
}
