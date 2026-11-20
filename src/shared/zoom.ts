export interface Zoom {
  scale: number
  cx: number
  cy: number
}

export const ZOOM_OFF: Zoom = { scale: 1, cx: 0.5, cy: 0.5 }
export const ZOOM_MAX = 4
export const ZOOM_STEP = 1.25
export const PAN_STEP = 0.2

export function isZoomed(z: Zoom): boolean {
  return z.scale > 1
}

export function clampZoom(z: Zoom): Zoom {
  if (!Number.isFinite(z.scale) || !Number.isFinite(z.cx) || !Number.isFinite(z.cy)) {
    return ZOOM_OFF
  }
  const scale = Math.min(ZOOM_MAX, Math.max(1, z.scale))
  if (scale === 1) return ZOOM_OFF
  const half = 1 / (2 * scale)
  const cx = Math.min(1 - half, Math.max(half, z.cx))
  const cy = Math.min(1 - half, Math.max(half, z.cy))
  return { scale, cx, cy }
}

export function zoomBy(z: Zoom, factor: number): Zoom {
  return clampZoom({ ...z, scale: z.scale * factor })
}

export function panBy(z: Zoom, dx: number, dy: number): Zoom {
  const win = 1 / z.scale
  return clampZoom({ scale: z.scale, cx: z.cx + dx * win, cy: z.cy + dy * win })
}

export function centreOn(z: Zoom, cx: number, cy: number): Zoom {
  return clampZoom({ scale: z.scale, cx, cy })
}

const noNegZero = (n: number): number => (n === 0 ? 0 : n)

export function zoomTransform(z: Zoom): string {
  if (!isZoomed(z)) return 'none'
  const half = 1 / (2 * z.scale)
  const tx = noNegZero(-(z.cx - half) * z.scale * 100)
  const ty = noNegZero(-(z.cy - half) * z.scale * 100)
  return `translate(${tx}%, ${ty}%) scale(${z.scale})`
}

export function viewRect(z: Zoom): { x: number; y: number; w: number; h: number } {
  const w = 1 / z.scale
  return { x: z.cx - w / 2, y: z.cy - w / 2, w, h: w }
}

export function pointToCentre(px: number, py: number): { cx: number; cy: number } {
  const c = (n: number): number => Math.min(1, Math.max(0, n))
  return { cx: c(px), cy: c(py) }
}
