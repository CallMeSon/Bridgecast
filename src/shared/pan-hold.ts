/** Pan arrows: a short press is one big step, a press held past HOLD_MS pans smoothly. */
export const HOLD_MS = 220
/** A tap moves the view by this share of the visible window (the CSS transition animates it). */
export const TAP_STEP = 0.5
/** Held pan speed in visible windows per second. */
export const HOLD_SPEED = 0.6
/** A stalled frame must not become a jump. */
const MAX_DT_MS = 50

export type PanDir = 'up' | 'down' | 'left' | 'right'
export interface PanDelta {
  dx: number
  dy: number
}

const UNIT: Record<PanDir, PanDelta> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
}

const scale = (d: PanDir, k: number): PanDelta => ({ dx: UNIT[d].dx * k, dy: UNIT[d].dy * k })

/**
 * One press of a pan arrow. `tick(now)` per animation frame returns the small step to send
 * (null while still within the tap window, or without a time delta); `release(now)` returns
 * the big tap step when the press ended before HOLD_MS, else null (the hold already panned).
 */
export function panPress(
  dir: PanDir,
  start: number
): {
  tick(now: number): PanDelta | null
  release(now: number): PanDelta | null
} {
  let last = start + HOLD_MS
  return {
    tick(now) {
      if (now - start < HOLD_MS) return null
      const dt = Math.min(MAX_DT_MS, Math.max(0, now - last))
      last = now
      return dt > 0 ? scale(dir, (HOLD_SPEED * dt) / 1000) : null
    },
    release(now) {
      return now - start < HOLD_MS ? scale(dir, TAP_STEP) : null
    }
  }
}
