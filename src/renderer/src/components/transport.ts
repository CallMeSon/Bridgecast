/** "03 / 12": both numbers padded to at least two digits. */
export function positionParts(index: number, total: number): [string, string] {
  const w = Math.max(2, String(total).length)
  return [String(index + 1).padStart(w, '0'), String(total).padStart(w, '0')]
}
