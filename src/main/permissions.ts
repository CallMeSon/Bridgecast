/**
 * Media permissions. Chromium hides audio output labels (and refuses
 * `setSinkId`) without them, so the app's own pages get `media` and
 * `speaker-selection`. Nothing else is granted, and no other origin gets anything.
 */
const ALLOWED = new Set(['media', 'speaker-selection'])

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
