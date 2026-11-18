import { scaleForWidth } from './scale'

export interface RenderedImage {
  width: number
  height: number
  pages: Uint8Array[]
}

/**
 * Pixel size of an image slide: the image is scaled down to `targetWidth` (never up),
 * keeping its aspect. A zero or non-finite size is refused with a user-facing message.
 */
export function imageSize(
  width: number,
  height: number,
  targetWidth: number
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('This image has no usable size. Try another file.')
  }
  const scale = Math.min(1, scaleForWidth(width, targetWidth))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/**
 * Renders one image file as the single PNG page of a deck. The slide protocol only serves
 * PNG, so an imported JPG/WebP/GIF/BMP/AVIF is decoded here (Chromium's image pipeline)
 * and re-encoded; animated images become their first frame.
 */
export async function renderImage(file: File, targetWidth: number): Promise<RenderedImage> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image cannot be opened. Try a PNG, JPG, WebP, GIF, BMP, or AVIF file.')
  }
  try {
    const size = imageSize(bitmap.width, bitmap.height, targetWidth)
    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('The image could not be drawn. Try another file.')
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return {
      width: size.width,
      height: size.height,
      pages: [new Uint8Array(await blob.arrayBuffer())]
    }
  } finally {
    bitmap.close()
  }
}
