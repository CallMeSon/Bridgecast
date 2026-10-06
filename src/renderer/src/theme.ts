export type Theme = 'dark' | 'light'

const KEY = 'theme'

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // Storage can be unavailable; the theme still applies for this session.
  }
}
