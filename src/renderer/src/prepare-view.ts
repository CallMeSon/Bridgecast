import { stageRect } from './stage'

export type ViewMode = 'fit' | 'actual'
export interface Box {
  width: number
  height: number
}
/** pan = page pixels of the visible top-left corner, only used in `actual`. */
export interface View {
  mode: ViewMode
  panX: number
  panY: number
}
/** Where the page is drawn inside the stage box (CSS px; left/top may be negative in `actual`). */
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

const MAP_WIDTH = 168
const MAP_MIN_HEIGHT = 24

function maxPan(canvas: Box, box: Box, dpr: number): { x: number; y: number } {
  return {
    x: Math.max(0, canvas.width - box.width * dpr),
    y: Math.max(0, canvas.height - box.height * dpr)
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
  const scale = 1 / dpr
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

export function clampPan(canvas: Box, box: Box, view: View, dpr: number): View {
  const max = maxPan(canvas, box, dpr)
  return { ...view, panX: clamp(view.panX, max.x), panY: clamp(view.panY, max.y) }
}

export function centred(canvas: Box, box: Box, dpr: number): View {
  const max = maxPan(canvas, box, dpr)
  return { mode: 'actual', panX: max.x / 2, panY: max.y / 2 }
}

export function panBy(
  canvas: Box,
  box: Box,
  view: View,
  dpr: number,
  dxCss: number,
  dyCss: number
): View {
  return clampPan(
    canvas,
    box,
    { ...view, panX: view.panX - dxCss * dpr, panY: view.panY - dyCss * dpr },
    dpr
  )
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

export function miniMap(
  canvas: Box,
  box: Box,
  view: View,
  dpr: number,
  width = MAP_WIDTH
): { width: number; height: number; rect: { x: number; y: number; w: number; h: number } } {
  const ms = canvas.width > 0 ? width / canvas.width : 0
  const height = Math.max(MAP_MIN_HEIGHT, canvas.height * ms)
  if (view.mode === 'fit') return { width, height, rect: { x: 0, y: 0, w: width, h: height } }
  return {
    width,
    height,
    rect: {
      x: view.panX * ms,
      y: view.panY * ms,
      w: Math.min(canvas.width, box.width * dpr) * ms,
      h: Math.min(canvas.height, box.height * dpr) * ms
    }
  }
}

export function panFromMiniMap(
  canvas: Box,
  box: Box,
  dpr: number,
  mx: number,
  my: number,
  width = MAP_WIDTH
): View {
  const ms = canvas.width > 0 ? width / canvas.width : 0
  if (ms <= 0) return { mode: 'actual', panX: 0, panY: 0 }
  const visW = Math.min(canvas.width, box.width * dpr)
  const visH = Math.min(canvas.height, box.height * dpr)
  return clampPan(
    canvas,
    box,
    { mode: 'actual', panX: mx / ms - visW / 2, panY: my / ms - visH / 2 },
    dpr
  )
}
