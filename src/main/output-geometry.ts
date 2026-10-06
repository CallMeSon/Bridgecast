/**
 * Pure sizing logic for the offscreen output window (no Electron imports).
 *
 * Offscreen windows paint at the display's scale factor and Electron 39 has no
 * per-window override. So the window is sized in DIP as target / scaleFactor,
 * which makes Chromium rasterize about target device pixels; the remaining
 * 1–3 px of rounding are cropped or padded, never resampled.
 */

export interface Size {
  width: number
  height: number
}

/** Window content size in DIP so that the painted bitmap is ≈ width×height device px. */
export function dipSize(width: number, height: number, scaleFactor: number): Size {
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return { width: Math.round(width / sf), height: Math.round(height / sf) }
}

/** Largest mismatch (px) still fixed by crop/pad: DIP rounding plus one DIP of window rounding. */
export function tolerance(scaleFactor: number): number {
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return Math.ceil(sf) + 1
}

export type FitMode = 'exact' | 'cropPad' | 'resize'

export function fitMode(painted: Size, target: Size, tol: number): FitMode {
  const dw = Math.abs(painted.width - target.width)
  const dh = Math.abs(painted.height - target.height)
  if (dw === 0 && dh === 0) return 'exact'
  return dw <= tol && dh <= tol ? 'cropPad' : 'resize'
}

const OPAQUE_BLACK = Buffer.from([0, 0, 0, 255]) // BGRA

/**
 * Copies a BGRA bitmap into an exactly width×height frame, aligned top-left:
 * extra rows/columns are dropped, missing ones become opaque black.
 */
export function cropOrPad(
  src: Buffer,
  srcWidth: number,
  srcHeight: number,
  width: number,
  height: number
): Buffer {
  const out = Buffer.alloc(width * height * 4)
  if (srcWidth < width || srcHeight < height) out.fill(OPAQUE_BLACK)
  const rowBytes = Math.min(srcWidth, width) * 4
  const rows = Math.min(srcHeight, height)
  for (let y = 0; y < rows; y++) {
    const from = y * srcWidth * 4
    src.copy(out, y * width * 4, from, from + rowBytes)
  }
  return out
}
