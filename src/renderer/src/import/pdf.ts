// The legacy build carries polyfills (e.g. Map.prototype.getOrInsertComputed)
// that Electron's Chromium does not have yet; the modern build fails at render.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
// Vite bundles the worker locally (emitted as an asset); no CDN, works offline.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { scaleForWidth } from './scale'

export { scaleForWidth }

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface RenderedPdf {
  width: number
  height: number
  pages: Uint8Array[]
}

/** Lets input, IPC and paints run between pages so a long PDF never freezes the operator UI. */
const yieldToUi = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

export async function renderPdf(
  data: Uint8Array,
  targetWidth: number,
  onPage?: (done: number, total: number) => void
): Promise<RenderedPdf> {
  let doc: pdfjs.PDFDocumentProxy
  try {
    doc = await pdfjs.getDocument({ data: data.slice() }).promise
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'PasswordException') {
      throw new Error('This PDF is password protected. Remove the protection, then import again.')
    }
    throw new Error(
      'The PDF is damaged or cannot be opened. Try exporting it again from the app that made it.'
    )
  }
  try {
    const pages: Uint8Array[] = []
    let width = 0
    let height = 0
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: scaleForWidth(base.width, targetWidth) })
        const w = Math.round(viewport.width)
        const h = Math.round(viewport.height)
        const canvas = new OffscreenCanvas(w, h)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport
        }).promise
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        pages.push(new Uint8Array(await blob.arrayBuffer()))
        if (n === 1) {
          width = w
          height = h
        }
        page.cleanup()
        onPage?.(n, doc.numPages)
        await yieldToUi()
      } catch (err) {
        throw new Error(
          `Page ${n} could not be rendered. Try exporting the PDF again from the app that made it.`,
          { cause: err }
        )
      }
    }
    if (pages.length === 0) throw new Error('The PDF has no pages. Choose another PDF file.')
    return { width, height, pages }
  } finally {
    await doc.loadingTask.destroy()
  }
}
