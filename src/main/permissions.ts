/**
 * Media permissions. Chromium hides audio output labels (and refuses
 * `setSinkId`) without them, so the app's own pages get `media` and
 * `speaker-selection`; `display-capture` is what a `chromeMediaSource: 'tab'`
 * capture of a web deck page asks for. Nothing else is granted, and no other
 * origin gets anything (web deck pages have their own deny-by-default session).
 */
const ALLOWED = new Set(['media', 'speaker-selection', 'display-capture'])

/** The app's own pages: the packaged `file:` page, or the dev server. */
export function isOwnOrigin(origin: string, devUrl: string | undefined): boolean {
  if (origin.startsWith('file:')) return true
  if (!devUrl) return false
  try {
    return new URL(origin).origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

export function permissionAllowed(
  permission: string,
  origin: string,
  devUrl: string | undefined
): boolean {
  return ALLOWED.has(permission) && isOwnOrigin(origin, devUrl)
}
