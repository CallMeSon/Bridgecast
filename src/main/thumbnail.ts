import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { nativeImage } from 'electron'

export const THUMB_WIDTH = 320
export const THUMB_QUALITY = 80

/**
 * Writes a JPEG thumbnail (THUMB_WIDTH px wide, same aspect ratio) of the image
 * `src` to `dest` (atomic rename). Throws when the image cannot be read or when
 * nativeImage is unavailable (outside Electron); callers fall back to the
 * full-size slide.
 */
export function writeThumbnail(src: string, dest: string): void {
  if (!nativeImage) throw new Error('nativeImage tidak tersedia')
  const img = nativeImage.createFromPath(src)
  if (img.isEmpty()) throw new Error('Gambar slide tidak bisa dibaca')
  const small =
    img.getSize().width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: 'good' }) : img
  const tmp = `${dest}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, small.toJPEG(THUMB_QUALITY))
    fs.renameSync(tmp, dest)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
}
