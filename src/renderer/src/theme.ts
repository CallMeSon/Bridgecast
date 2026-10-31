import {
  deriveAccent,
  parseAccent,
  parseHex,
  parseThemePref,
  resolveTheme,
  type AccentId,
  type Theme,
  type ThemePref
} from './appearance'

export type { AccentId, Theme, ThemePref }

const THEME_KEY = 'theme'
const ACCENT_KEY = 'accent'
const CUSTOM_KEY = 'accent-custom'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
}

export function loadThemePref(): ThemePref {
  return parseThemePref(read(THEME_KEY))
}

export function saveThemePref(p: ThemePref): void {
  write(THEME_KEY, p)
}

export function loadAccent(): AccentId {
  return parseAccent(read(ACCENT_KEY))
}

export function saveAccent(a: AccentId): void {
  write(ACCENT_KEY, a)
}

/** The stored custom colour as `#rrggbb`, or null. */
export function loadCustomAccent(): string | null {
  return parseHex(read(CUSTOM_KEY))
}

export function saveCustomAccent(hex: string): void {
  const h = parseHex(hex)
  if (h) write(CUSTOM_KEY, h)
}

const MOTION_KEY = 'reduce-motion'

export function loadReduceMotion(): boolean {
  return read(MOTION_KEY) === '1'
}

export function saveReduceMotion(on: boolean): void {
  write(MOTION_KEY, on ? '1' : '0')
}

/** Sets or clears `data-reduce-motion` on `<html>`; CSS turns off decorative transitions. */
export function applyReduceMotion(on: boolean): void {
  if (on) document.documentElement.dataset.reduceMotion = ''
  else delete document.documentElement.dataset.reduceMotion
}

const CUSTOM_VARS = ['--accent', '--accent-fill', '--accent-ink', '--on-accent'] as const

/**
 * Sets `data-theme` and `data-accent` on `<html>`. While `pref` is `'system'` it follows the OS
 * live. `onTheme` receives the resolved theme now and on every OS change. Returns the unsubscribe.
 */
export function applyAppearance(
  pref: ThemePref,
  accent: AccentId,
  onTheme?: (t: Theme) => void
): () => void {
  const root = document.documentElement
  const mq = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null
  const apply = (): void => {
    const theme = resolveTheme(pref, mq?.matches ?? true)
    root.dataset.theme = theme
    root.dataset.accent = accent
    const custom = accent === 'custom' ? loadCustomAccent() : null
    if (custom) {
      const t = deriveAccent(custom, theme)
      const values = [t.accent, t.fill, t.ink, t.on]
      CUSTOM_VARS.forEach((v, i) => root.style.setProperty(v, values[i]))
    } else {
      CUSTOM_VARS.forEach((v) => root.style.removeProperty(v))
    }
    onTheme?.(theme)
  }
  apply()
  if (pref !== 'system' || !mq) return () => {}
  mq.addEventListener('change', apply)
  return () => mq.removeEventListener('change', apply)
}
