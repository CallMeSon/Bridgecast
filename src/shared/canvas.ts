/** Output size in pixels, the same for the HDMI window, KV and thumbnails' aspect. */
export interface Canvas {
  width: number
  height: number
}

/** A canvas plus where it came from: an event override or the machine default. */
export interface ResolvedCanvas extends Canvas {
  origin: 'event' | 'default'
}

export const DEFAULT_CANVAS: Readonly<Canvas> = Object.freeze({ width: 1920, height: 1080 })

export const CANVAS_PRESETS: readonly Canvas[] = Object.freeze([
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 3840, height: 2160 }),
  Object.freeze({ width: 1280, height: 720 })
])

export const CANVAS_INVALID =
  'Use a width and height from 320 to 7680 pixels, at most 3840×2160 in total.'
export const CANVAS_NO_HDMI = 'Connect the HDMI display first.'
export const CANVAS_DISPLAY_TOO_LARGE =
  'This display is larger than 3840×2160 in total. Use Custom instead.'
export const CANVAS_LIVE_NOTICE = 'Changing the canvas changes what the audience sees.'
export const CANVAS_CHANGE_LIVE = `${CANVAS_LIVE_NOTICE} Change it now?`

const MIN_SIDE = 320
const MAX_SIDE = 7680
/** Total pixel budget (4K UHD): wider canvases such as 7680×1080 fit, 7680×4320 does not. */
const MAX_PIXELS = 3840 * 2160

/** Rounds down to an integer, then down to an even number (video and NDI-style outputs want even sides). */
function evenSide(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const n = Math.floor(raw)
  return n - (n % 2)
}

/**
 * Any value → a valid Canvas or null. Each side is rounded down to an even
 * number first, then checked (320–7680 per side, at most 3840×2160 in total),
 * so 1921 becomes 1920 and 7681 becomes 7680 instead of being rejected.
 */
export function sanitizeCanvas(raw: unknown): Canvas | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const width = evenSide(r.width)
  const height = evenSide(r.height)
  if (width === null || height === null) return null
  if (width < MIN_SIDE || width > MAX_SIDE || height < MIN_SIDE || height > MAX_SIDE) return null
  if (width * height > MAX_PIXELS) return null
  return { width, height }
}

/**
 * The canvas an event shows: its own override when valid, else the machine
 * default. The override is sanitized here too, because it comes from a file.
 */
export function resolveCanvas(
  eventCanvas: Canvas | null | undefined,
  machine: Canvas
): ResolvedCanvas {
  const own = sanitizeCanvas(eventCanvas)
  return own
    ? { ...own, origin: 'event' }
    : { width: machine.width, height: machine.height, origin: 'default' }
}

/** Short text for the UI, e.g. `3840×1080 (event)`; the origin is shown in words, not colour. */
export function canvasLabel(c: ResolvedCanvas): string {
  return `${c.width}×${c.height} (${c.origin})`
}

/** The canvas that matches a display's size, or null when no display is connected. */
export function displayCanvas(d: { width: number; height: number } | null): Canvas | null {
  return d ? sanitizeCanvas(d) : null
}

/** How a deck fills the canvas: CSS `contain` / `cover` / `fill`. */
export type DeckFit = 'fit' | 'fill' | 'stretch'

export const DECK_FITS: readonly DeckFit[] = Object.freeze(['fit', 'fill', 'stretch'] as const)

export function isDeckFit(v: unknown): v is DeckFit {
  return typeof v === 'string' && (DECK_FITS as readonly string[]).includes(v)
}

/** Any value → a valid DeckFit; anything unknown (or missing, from older decks) is `fit`. */
export function sanitizeFit(raw: unknown): DeckFit {
  return isDeckFit(raw) ? raw : 'fit'
}

/** A rectangle inside the canvas, in canvas pixels. */
export interface ContentRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Rounds down to an even number. The tiny epsilon keeps float error (1919.9999999999998)
 * from dropping a pixel.
 */
function evenDown(n: number): number {
  const whole = Math.floor(n + 1e-6)
  return whole - (whole % 2)
}

/**
 * The part of the canvas that holds the slide, without the black bars of a Fit deck.
 * `content` is the slide's own size (deck width/height) and `fit` its DeckFit; null `content`
 * (KV, Black, web pages, streams) or a fit other than 'fit' gives the whole canvas.
 * Sides are rounded down to even numbers (senders want even sides), x/y are even too, and the
 * rect never leaves the canvas and is never smaller than 2x2.
 */
export function contentRect(
  canvas: Canvas,
  content: { width: number; height: number } | null,
  fit: DeckFit
): ContentRect {
  const whole: ContentRect = { x: 0, y: 0, width: canvas.width, height: canvas.height }
  if (content === null || fit !== 'fit') return whole
  const cw = content.width
  const ch = content.height
  if (!(Number.isFinite(cw) && cw > 0 && Number.isFinite(ch) && ch > 0)) return whole

  const scale = Math.min(canvas.width / cw, canvas.height / ch)
  const width = Math.min(canvas.width, Math.max(2, evenDown(cw * scale)))
  const height = Math.min(canvas.height, Math.max(2, evenDown(ch * scale)))
  const x = Math.max(0, Math.min(canvas.width - width, evenDown((canvas.width - width) / 2)))
  const y = Math.max(0, Math.min(canvas.height - height, evenDown((canvas.height - height) / 2)))
  return { x, y, width, height }
}

/** Pixel width a PowerPoint file is exported at when imported. */
export const IMPORT_WIDTH = 1920
