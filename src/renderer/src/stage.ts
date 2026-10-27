import type { Canvas } from '../../shared/canvas'

/**
 * The largest rect with the canvas aspect that fits in `box`, centred. The
 * output window is whatever size the display is; the stage inside it keeps the
 * canvas aspect so Fit, Fill and Stretch are judged against the canvas, and the
 * rest of the window stays black.
 */
export function stageRect(
  canvas: Canvas,
  box: { width: number; height: number }
): { width: number; height: number; left: number; top: number } {
  if (box.width <= 0 || box.height <= 0) return { width: 0, height: 0, left: 0, top: 0 }
  const scale = Math.min(box.width / canvas.width, box.height / canvas.height)
  const width = canvas.width * scale
  const height = canvas.height * scale
  return { width, height, left: (box.width - width) / 2, top: (box.height - height) / 2 }
}
