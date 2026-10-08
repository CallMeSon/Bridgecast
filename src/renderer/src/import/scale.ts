export function scaleForWidth(pageWidth: number, targetWidth: number): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
    throw new Error('The PDF page width is not valid.')
  }
  return targetWidth / pageWidth
}
