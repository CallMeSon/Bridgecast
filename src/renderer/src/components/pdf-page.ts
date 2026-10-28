/** Longest a page may take to draw before the layer gives up and shows its poster. */
export const PDF_PENDING_MS = 3000

export interface PdfPageHooks {
  /** Draws the page (and renders the next one ahead). */
  render: () => Promise<HTMLCanvasElement>
  onDrawn: (src: HTMLCanvasElement) => void
  /** The page cannot be drawn: show the poster. */
  onFailed: (why: unknown) => void
  /** Fires once, when the page is drawn or the poster takes over. */
  onReady: () => void
  log?: (msg: string, why?: unknown) => void
}

/** Runs one page draw for a layer; the returned function cancels it (the layer went away). */
export function showPdfPage(h: PdfPageHooks, label: string): () => void {
  const log = h.log ?? ((m, w) => console.error(m, w))
  let live = true
  let signalled = false
  const signal = (): void => {
    if (signalled) return
    signalled = true
    h.onReady()
  }
  const giveUp = setTimeout(() => {
    if (!live || signalled) return
    log(`[pdf] ${label} took over ${PDF_PENDING_MS} ms, showing its poster`)
    h.onFailed('timeout')
    signal()
  }, PDF_PENDING_MS)
  h.render()
    .then((src) => {
      if (!live) return
      h.onDrawn(src)
      signal()
    })
    .catch((e: unknown) => {
      if (!live) return
      log(`[pdf] ${label} could not be drawn, showing its poster:`, e)
      h.onFailed(e)
      signal()
    })
    .finally(() => clearTimeout(giveUp))
  return () => {
    live = false
    clearTimeout(giveUp)
  }
}
