import * as pdfjs from 'pdfjs-dist'
// Vite bundles the worker locally (emitted as an asset); no CDN, works offline.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { scaleForWidth } from './scale'

export { scaleForWidth }

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface RenderedPdf {
  width: number
  height: number
  pages: Uint8Array[]
}

export async function renderPdf(data: Uint8Array, targetWidth: number): Promise<RenderedPdf> {
  let doc: pdfjs.PDFDocumentProxy
  try {
    doc = await pdfjs.getDocument({ data: data.slice() }).promise
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'PasswordException') {
      throw new Error('PDF dilindungi kata sandi. Hapus proteksi lalu impor ulang.')
    }
    throw new Error(
      'File PDF rusak atau tidak bisa dibuka. Coba ekspor ulang PDF dari aplikasi asalnya.'
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
      } catch {
        throw new Error(`Halaman ${n} gagal dirender. Coba ekspor ulang PDF dari aplikasi asalnya.`)
      }
    }
    if (pages.length === 0) throw new Error('PDF tidak memiliki halaman. Pilih file PDF lain.')
    return { width, height, pages }
  } finally {
    await doc.loadingTask.destroy()
  }
}
