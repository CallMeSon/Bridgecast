// Pure size math for the resizable operator panels (px). No DOM access here.

export type Axis = 'left' | 'right' | 'strip'
export type Layout = Record<Axis, number>
export type Stored = Partial<Layout>

export const SIDE_MIN = 200
export const CENTER_MIN = 420
export const STRIP_MIN = 120
export const STRIP_MAX_RATIO = 0.4
/** Keyboard step for a focused splitter. */
export const STEP = 16
const NARROW = 1400

export function defaultLayout(width: number): Layout {
  return width <= NARROW
    ? { left: 256, right: 288, strip: 176 }
    : { left: 288, right: 320, strip: 176 }
}

/** Allowed range of one axis, given the current size of the others. */
export function limits(
  axis: Axis,
  cur: Layout,
  width: number,
  height: number
): { min: number; max: number } {
  if (axis === 'strip') {
    return { min: STRIP_MIN, max: Math.max(STRIP_MIN, Math.floor(height * STRIP_MAX_RATIO)) }
  }
  const other = axis === 'left' ? cur.right : cur.left
  return { min: SIDE_MIN, max: Math.max(SIDE_MIN, Math.floor(width - other - CENTER_MIN)) }
}

export function clampSize(
  axis: Axis,
  value: number,
  cur: Layout,
  width: number,
  height: number
): number {
  const { min, max } = limits(axis, cur, width, height)
  return Math.min(max, Math.max(min, Math.round(value)))
}

const AXES: Axis[] = ['left', 'right', 'strip']

/** Reads the stored JSON; anything that is not a positive finite number is dropped. */
export function parseStored(raw: string | null): Stored {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: Stored = {}
  for (const k of AXES) {
    const v = (data as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

export function serializeStored(s: Stored): string {
  return JSON.stringify(s)
}

/** Effective sizes for a window: stored or default, clamped; the right panel gives way first. */
export function resolveLayout(stored: Stored, width: number, height: number): Layout {
  const def = defaultLayout(width)
  let left = Math.max(SIDE_MIN, Math.round(stored.left ?? def.left))
  let right = Math.max(SIDE_MIN, Math.round(stored.right ?? def.right))
  const over = left + right + CENTER_MIN - width
  if (over > 0) {
    const cutRight = Math.min(over, right - SIDE_MIN)
    right -= cutRight
    left = Math.max(SIDE_MIN, left - (over - cutRight))
  }
  const strip = clampSize('strip', stored.strip ?? def.strip, def, width, height)
  return { left, right, strip }
}
