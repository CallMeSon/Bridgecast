export function scaleForWidth(pageWidth: number, targetWidth: number): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) {
    throw new Error('Lebar halaman PDF tidak valid.')
  }
  return targetWidth / pageWidth
}
