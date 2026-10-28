import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PDF_PENDING_MS, showPdfPage } from './pdf-page'

const canvas = { width: 10, height: 10 } as HTMLCanvasElement
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function hooks(render: () => Promise<HTMLCanvasElement>): {
  render: () => Promise<HTMLCanvasElement>
  onDrawn: Mock
  onFailed: Mock
  onReady: Mock
  log: Mock
} {
  return {
    render,
    onDrawn: vi.fn(),
    onFailed: vi.fn(),
    onReady: vi.fn(),
    log: vi.fn()
  }
}

describe('showPdfPage', () => {
  it('an unrenderable page: poster (onFailed), error logged, ready once; the next page stays vector', async () => {
    const bad = hooks(() => Promise.reject(new Error('bad page')))
    showPdfPage(bad, 'deck page 2')
    await flush()
    expect(bad.onFailed).toHaveBeenCalledTimes(1)
    expect(bad.onDrawn).not.toHaveBeenCalled()
    expect(bad.log).toHaveBeenCalledTimes(1)
    expect(bad.onReady).toHaveBeenCalledTimes(1)

    const good = hooks(() => Promise.resolve(canvas))
    showPdfPage(good, 'deck page 3')
    await flush()
    expect(good.onDrawn).toHaveBeenCalledWith(canvas)
    expect(good.onFailed).not.toHaveBeenCalled()
    expect(good.log).not.toHaveBeenCalled()
    expect(good.onReady).toHaveBeenCalledTimes(1)
  })

  describe('timeout and cancel', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())
    it('a page that never draws falls back to the poster after the pending time', async () => {
      const h = hooks(() => new Promise(() => undefined))
      showPdfPage(h, 'x')
      await vi.advanceTimersByTimeAsync(PDF_PENDING_MS + 1)
      expect(h.onFailed).toHaveBeenCalledTimes(1)
      expect(h.onReady).toHaveBeenCalledTimes(1)
    })
    it('a cancelled draw reports nothing', async () => {
      const h = hooks(() => Promise.reject(new Error('x')))
      showPdfPage(h, 'x')()
      await vi.advanceTimersByTimeAsync(PDF_PENDING_MS + 1)
      expect(h.onFailed).not.toHaveBeenCalled()
      expect(h.onReady).not.toHaveBeenCalled()
    })
  })
})
