/**
 * The seek slider's displayed value. While dragging it is the drag value; after release it
 * stays the released value until main's clock carries a newer seek counter, so the thumb never
 * snaps back to the old position.
 */
export interface SeekView {
  drag: number | null
  /** Released value waiting for main; `seek` is the clock's counter when it was sent. */
  pending: { at: number; seek: number } | null
}

export const SEEK_IDLE: SeekView = { drag: null, pending: null }

export function seekDrag(v: SeekView, at: number): SeekView {
  return { ...v, drag: at }
}

export function seekRelease(at: number, clockSeek: number): SeekView {
  return { drag: null, pending: { at, seek: clockSeek } }
}

/** Drop the pending value once the clock has moved past the counter it was sent at. */
export function seekSettle(v: SeekView, clockSeek: number): SeekView {
  return v.pending && clockSeek > v.pending.seek ? { ...v, pending: null } : v
}

/** Seconds at a pointer fraction (0..1) of the bar; exact, no thumb or padding offset. */
export function timeAtFraction(f: number, duration: number): number {
  return Math.min(1, Math.max(0, f)) * Math.max(0, duration)
}

const KEY_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: 10,
  PageDown: -10
}

/** Keyboard seek: arrows 1 s, PageUp/PageDown 10 s; null = key not handled here. */
export function keySeek(key: string, at: number, duration: number): number | null {
  const d = KEY_STEP[key]
  return d === undefined ? null : Math.min(duration, Math.max(0, at + d))
}

/** Value to show: drag, else pending, else the live clock position. */
export function seekShown(v: SeekView, clockPos: number): number {
  return v.drag ?? v.pending?.at ?? clockPos
}
