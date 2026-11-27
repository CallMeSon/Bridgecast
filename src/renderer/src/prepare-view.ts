import { stageRect } from './stage'

export type ViewMode = 'fit' | 'zoom'
export interface Box {
  width: number
  height: number
}
/**
 * Preview view. `zoom` is relative to 100% (one page pixel per device pixel), so the CSS scale is
 * zoom / dpr. `fit` ignores zoom and pan. pan = page pixels of the visible top-left corner.
 */
export interface View {
  mode: ViewMode
  zoom: number
  panX: number
  panY: number
}
/** Where the page is drawn inside the stage box (CSS px; left/top may be negative when zoomed). */
export interface Layout {
  left: number
  top: number
  width: number
  height: number
  scale: number
  cropped: boolean
}
export interface DOMRectLike {
  left: number
  top: number
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4
/** Steps for the + and - buttons and keys. */
const ZOOM_STOPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
/** Click-to-cycle presets after Fit. */
export const ZOOM_PRESETS = [1, 2, 0.5]

export const FIT: View = { mode: 'fit', zoom: 1, panX: 0, panY: 0 }

export function clampZoom(z: number): number {
  return Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM)
}

function maxPan(canvas: Box, box: Box, scale: number): { x: number; y: number } {
  return {
    x: Math.max(0, canvas.width - box.width / scale),
    y: Math.max(0, canvas.height - box.height / scale)
  }
}

function clamp(v: number, max: number): number {
  return Math.min(Math.max(v, 0), max)
}

export function layout(canvas: Box, box: Box, view: View, dpr: number): Layout {
  if (view.mode === 'fit') {
    const r = stageRect(canvas, box)
    const scale = canvas.width > 0 ? r.width / canvas.width : 0
    return { ...r, scale, cropped: false }
  }
  const scale = view.zoom / dpr
  const width = canvas.width * scale
  const height = canvas.height * scale
  return {
    left: width <= box.width ? (box.width - width) / 2 : -view.panX * scale,
    top: height <= box.height ? (box.height - height) / 2 : -view.panY * scale,
    width,
    height,
    scale,
    cropped: width > box.width || height > box.height
  }
}

/** The zoom the view shows now (Fit included), relative to 100%. */
export function effectiveZoom(canvas: Box, box: Box, view: View, dpr: number): number {
  return view.mode === 'fit' ? layout(canvas, box, view, dpr).scale * dpr : view.zoom
}

export function clampPan(canvas: Box, box: Box, view: View, dpr: number): View {
  if (view.mode === 'fit') return view
  const max = maxPan(canvas, box, view.zoom / dpr)
  return { ...view, panX: clamp(view.panX, max.x), panY: clamp(view.panY, max.y) }
}

export function centred(canvas: Box, box: Box, dpr: number, zoom = 1): View {
  const max = maxPan(canvas, box, zoom / dpr)
  return { mode: 'zoom', zoom, panX: max.x / 2, panY: max.y / 2 }
}

export function panBy(
  canvas: Box,
  box: Box,
  view: View,
  dpr: number,
  dxCss: number,
  dyCss: number
): View {
  if (view.mode === 'fit') return view
  const scale = view.zoom / dpr
  return clampPan(
    canvas,
    box,
    { ...view, panX: view.panX - dxCss / scale, panY: view.panY - dyCss / scale },
    dpr
  )
}

/**
 * Zoom to `zoom`, keeping the page point under (px, py) (CSS px inside the box) where it is.
 * Works from Fit too; the result is always a `zoom` view.
 */
export function zoomAt(
  canvas: Box,
  box: Box,
  view: View,
  dpr: number,
  zoom: number,
  px: number,
  py: number
): View {
  const l = layout(canvas, box, view, dpr)
  const z = clampZoom(zoom)
  if (l.scale <= 0) return centred(canvas, box, dpr, z)
  const s = z / dpr
  const pageX = (px - l.left) / l.scale
  const pageY = (py - l.top) / l.scale
  return clampPan(
    canvas,
    box,
    { mode: 'zoom', zoom: z, panX: pageX - px / s, panY: pageY - py / s },
    dpr
  )
}

/** Next + or - stop from the current zoom. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const eps = 0.005
  if (dir > 0) return ZOOM_STOPS.find((z) => z > current + eps) ?? MAX_ZOOM
  return [...ZOOM_STOPS].reverse().find((z) => z < current - eps) ?? MIN_ZOOM
}

/** What clicking the percentage does: Fit goes to 100%, then 200%, 50%, back to Fit. */
export function cycleZoom(view: View, current: number): number | 'fit' {
  if (view.mode === 'fit') return ZOOM_PRESETS[0]
  const i = ZOOM_PRESETS.findIndex((z) => Math.abs(z - current) < 0.005)
  if (i < 0) return ZOOM_PRESETS[0]
  return i + 1 < ZOOM_PRESETS.length ? ZOOM_PRESETS[i + 1] : 'fit'
}

export function toPage(
  clientX: number,
  clientY: number,
  stage: DOMRectLike,
  l: Layout
): { x: number; y: number } | null {
  if (l.width <= 0 || l.height <= 0) return null
  const x = (clientX - stage.left - l.left) / l.width
  const y = (clientY - stage.top - l.top) / l.height
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}
