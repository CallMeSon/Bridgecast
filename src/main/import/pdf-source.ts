import * as fs from 'fs'
import * as path from 'path'

/**
 * Deck fields for a rendered PDF: when `sourcePath` is an absolute path of an existing .pdf file,
 * the PDF is stored (source.pdf) and the deck plays as vector; otherwise the deck stays on images.
 * A bad path is ignored, never an error.
 */
export function pdfSourceFields(
  sourcePath: unknown
): { sourcePath: string; playback: 'vector' } | Record<string, never> {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) return {}
  if (!/\.pdf$/i.test(sourcePath)) return {}
  try {
    if (!fs.statSync(sourcePath).isFile()) return {}
  } catch {
    return {}
  }
  return { sourcePath, playback: 'vector' }
}
