import { beforeEach, describe, expect, it, vi } from 'vitest'

const destroy = vi.fn(() => Promise.resolve())
const getDocument = vi.fn()
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: (...a: unknown[]) => getDocument(...a)
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

import { acquirePdf, releasePdf, renderPdfPage } from './pdf-doc'

const made: { width: number; height: number }[] = []

beforeEach(() => {
  made.length = 0
  destroy.mockClear()
  getDocument.mockReset()
  getDocument.mockImplementation(() => ({
    destroy,
    promise: Promise.resolve({
      numPages: 20,
      getPage: () =>
        Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 50 * scale
          }),
          render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          cleanup: vi.fn()
        })
    })
  }))
  vi.stubGlobal('document', {
    createElement: () => {
      const c = { width: 0, height: 0, getContext: () => ({ fillRect: vi.fn(), fillStyle: '' }) }
      made.push(c)
      return c
    }
  })
})

const stage = { width: 100, height: 50 }

describe('pdf-doc', () => {
  it('shares one document per URL and destroys it with the last release', async () => {
    const a = acquirePdf('slide://d/source.pdf')
    const b = acquirePdf('slide://d/source.pdf')
    expect(b).toBe(a)
    expect(getDocument).toHaveBeenCalledTimes(1)
    const page = await renderPdfPage(a, 1, stage, 'fit', 1)
    expect(page.width).toBe(100)
    releasePdf(a)
    expect(destroy).not.toHaveBeenCalled()
    releasePdf(b)
    await flushPromises()
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(page.width).toBe(0)
    expect(page.height).toBe(0)
    // A new acquire loads again.
    releasePdf(acquirePdf('slide://d/source.pdf'))
    expect(getDocument).toHaveBeenCalledTimes(2)
  })

  it('keeps at most 4 rendered pages, freeing the oldest', async () => {
    const e = acquirePdf('slide://e/source.pdf')
    const pages: HTMLCanvasElement[] = []
    for (let n = 1; n <= 6; n++) pages.push(await renderPdfPage(e, n, stage, 'fit', 1))
    await flushPromises()
    expect(e.pages.size).toBe(4)
    expect(pages[0].width).toBe(0)
    expect(pages[1].width).toBe(0)
    expect(pages[5].width).toBe(100)
    // Asking again for a kept page returns the same canvas (the page rendered ahead).
    expect(await renderPdfPage(e, 6, stage, 'fit', 1)).toBe(pages[5])
    releasePdf(e)
  })
})

const flushPromises = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
