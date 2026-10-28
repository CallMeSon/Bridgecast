import type { DeckFit } from '../../shared/canvas'

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
  if (fit === 'stretch') {
    return {
      width: Math.max(1, Math.round(stage.width * dpr)),
      height: Math.max(1, Math.round(stage.height * dpr)),
      scale: sx * dpr
    }
  }
  const scale = Math.max(fit === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy), 0) * dpr
  return {
    width: Math.max(1, Math.round(pw * scale)),
    height: Math.max(1, Math.round(ph * scale)),
    scale
  }
}
