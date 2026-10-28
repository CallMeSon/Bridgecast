import type { DeckFit } from '../../shared/canvas'

/** Longest side of a rendered page canvas (Chromium's limit is 16384). */
export const MAX_PDF_SIDE = 8192
/** Largest area of a rendered page canvas (~16 MP); 5-7 of them are held at once. */
export const MAX_PDF_PIXELS = 16_000_000

/**
 * Canvas size to render a PDF page at so it is sharp on a `stage` of CSS pixels at
 * device pixel ratio `dpr`. `page` is the page at scale 1 (points). `fit` follows the
 * deck: contain (`fit`) and cover (`fill`) keep the page aspect (the canvas is the
 * whole scaled page and CSS object-fit places it); `stretch` renders exactly the stage
 * and `scale` is its horizontal scale (the caller adds the vertical ratio).
 */
export function pdfRenderSize(
  stage: { width: number; height: number },
  page: { width: number; height: number },
  fit: DeckFit,
  dpr: number
): { width: number; height: number; scale: number } {
  const pw = Math.max(page.width, 1)
  const ph = Math.max(page.height, 1)
  const sx = stage.width / pw
  const sy = stage.height / ph
  let scale: number
  let w: number
  let h: number
  if (fit === 'stretch') {
    w = Math.max(stage.width * dpr, 1)
    h = Math.max(stage.height * dpr, 1)
    scale = sx * dpr
  } else {
    scale = Math.max(fit === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy), 0) * dpr
    w = pw * scale
    h = ph * scale
  }
  // CSS scales the canvas up to the stage, so a clamp only costs sharpness.
  const k = Math.min(
    1,
    MAX_PDF_SIDE / Math.max(w, h, 1),
    Math.sqrt(MAX_PDF_PIXELS / Math.max(w * h, 1))
  )
  return {
    width: Math.max(1, Math.round(w * k)),
    height: Math.max(1, Math.round(h * k)),
    scale: scale * k
  }
}
