// Pure theme and accent logic. No DOM, no storage: theme.ts layers those on top.

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'
export type AccentId = 'orange' | 'violet' | 'blue' | 'rose' | 'sand' | 'custom'

export const ACCENT_IDS: readonly AccentId[] = ['orange', 'violet', 'blue', 'rose', 'sand', 'custom']

/** Panel surface per theme; equals `--panel` in tokens.css. */
export const PANEL: Record<Theme, string> = { light: '#ffffff', dark: '#1d1e25' }

export interface AccentTokens {
  /** Rings and tints. */
  accent: string
  /** Surface behind text or a knob; often equal to `accent`. */
  fill: string
  /** Accent as text on the panel. */
  ink: string
  /** Text on `fill`. */
  on: string
}

export function parseThemePref(v: unknown): ThemePref {
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function parseAccent(v: unknown): AccentId {
  return typeof v === 'string' && (ACCENT_IDS as readonly string[]).includes(v)
    ? (v as AccentId)
    : 'orange'
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
}

const same = (accent: string, ink: string, on: string): AccentTokens => ({
  accent,
  fill: accent,
  ink,
  on
})

const BLUE: Record<Theme, AccentTokens> = {
  light: same('#2160d4', '#1c55bd', '#ffffff'),
  dark: same('#82b2ff', '#98c0ff', '#08193a')
}

export const ACCENTS: Record<AccentId, Record<Theme, AccentTokens>> = {
  orange: {
    light: { accent: '#e5600e', fill: '#c84f0c', ink: '#9a4208', on: '#ffffff' },
    dark: same('#f26f1c', '#ff9d5e', '#1a0a00')
  },
  violet: {
    light: same('#5b4bd6', '#5342c9', '#ffffff'),
    dark: same('#a99cff', '#b9aeff', '#16112f')
  },
  blue: BLUE,
  rose: {
    light: same('#9a4586', '#8d3f7a', '#ffffff'),
    dark: same('#e3a3d2', '#ebb6dd', '#2b0f25')
  },
  sand: {
    light: same('#85652a', '#77590f', '#ffffff'),
    dark: same('#dcc283', '#e5cf9d', '#241a07')
  },
  // Placeholder until a hex is stored; see deriveAccent.
  custom: BLUE
}

function channel(n: number): number {
  const c = n / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

/** WCAG 2.1 contrast ratio of two `#rrggbb` colours. */
export function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Accepts `#rgb` or `#rrggbb`; returns lower-case `#rrggbb` or null. */
export function parseHex(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return '#' + h.toLowerCase()
}

function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16)
  const y = parseInt(b.slice(1), 16)
  const ch = (s: number): number =>
    Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t)
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)
}

/** Move `hex` toward `toward` in small steps until it reaches `min` contrast on `bg`. */
function reach(hex: string, toward: string, bg: string, min: number): string {
  let out = hex
  for (let t = 0; t <= 1.0001 && contrast(out, bg) < min; t += 0.05) out = mix(hex, toward, t)
  return out
}

/**
 * Tokens for a user chosen colour that still meet the contrast rules: the ring is the colour
 * pushed to 3:1 on the panel, the fill keeps 4.5:1 against its text, the ink reaches 4.5:1.
 */
export function deriveAccent(hex: string, theme: Theme): AccentTokens {
  const panel = PANEL[theme]
  const away = theme === 'light' ? '#000000' : '#ffffff'
  const accent = reach(hex, away, panel, 3)
  const ink = reach(hex, away, panel, 4.5)
  const on = contrast('#ffffff', hex) >= contrast('#000000', hex) ? '#ffffff' : '#000000'
  const fill = reach(hex, on === '#ffffff' ? '#000000' : '#ffffff', on, 4.5)
  return { accent, fill, ink, on }
}
