/** Shared by the importers (PowerPoint, LibreOffice) and the editor. */

export type ImportedDeck = {
  name: string
  width: number
  height: number
  slides: { pngPath: string; notes: string; clicks: number; hidden: boolean }[]
  /** PDF export of the whole deck, hidden slides included. */
  pdfPath: string
  /** No animation, transition or media anywhere in the deck. */
  isStatic: boolean
  /** The working file (kept as source.<ext>; also original.<ext> unless `originalPath` is set). */
  sourcePath: string
  /** The imported file when `sourcePath` is a conversion of it (Linux: .odp). */
  originalPath?: string
  /** `sourcePath` is a fresh conversion of the imported file (not an edit of it). */
  converted?: boolean
}

export const NO_SLIDES_MESSAGE =
  'No slides were exported. Make sure the file contains slides, then try again.'

/** A positive finite number floored to an integer; anything else becomes 0. */
export const num = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0

/** Maps `v` to exactly `n` items: picked from the array, or `fill` where it is missing or short. */
export function padded<T>(v: unknown, n: number, fill: T, pick: (x: unknown) => T): T[] {
  const arr = Array.isArray(v) ? v : []
  return Array.from({ length: n }, (_, i) => (i < arr.length ? pick(arr[i]) : fill))
}
