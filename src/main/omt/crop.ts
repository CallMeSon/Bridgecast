import type { ContentRect } from '../../shared/canvas'

/**
 * Copies one rectangle out of a BGRA bitmap (4 bytes per pixel, rows `srcWidth` pixels wide).
 * The rect must lie inside the bitmap; the caller checks that (see output.ts). Returns a new
 * buffer, so the source can keep its own transfer.
 */
export function cropBgra(data: ArrayBuffer, srcWidth: number, rect: ContentRect): ArrayBuffer {
  const out = new ArrayBuffer(rect.width * rect.height * 4)
  const src = new Uint8Array(data)
  const dst = new Uint8Array(out)
  const rowBytes = rect.width * 4
  const srcRow = srcWidth * 4
  for (let y = 0; y < rect.height; y++) {
    const from = (rect.y + y) * srcRow + rect.x * 4
    dst.set(src.subarray(from, from + rowBytes), y * rowBytes)
  }
  return out
}
