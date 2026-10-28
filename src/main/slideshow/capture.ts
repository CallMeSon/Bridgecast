/** What the app asks of Electron's `desktopCapturer` (a fake in tests). */
export type GetSources = (types: ['window']) => Promise<{ id: string }[]>

export const SOURCE_NOT_FOUND =
  'The slide show window cannot be captured. The output shows still slides.'

/**
 * The capture source of a slide show window: the `desktopCapturer` source whose id is
 * `window:<windowId>:<n>`. The bridge reports the window as a decimal handle; anything
 * else (empty, a screen, a handle with extra parts) matches nothing, and a screen source
 * is never returned.
 */
export function sourceIdForWindow(sources: { id: string }[], windowId: string): string | null {
  if (!/^\d+$/.test(windowId)) return null
  const prefix = `window:${windowId}:`
  return sources.find((s) => s.id.startsWith(prefix))?.id ?? null
}

/**
 * Capture id of a deck's slide show window for an app window. Asks for windows only and
 * never falls back to another window or a screen: with no window, or when the capturer
 * fails, it rejects and the output shows the slide's PNG.
 */
export async function slideshowSourceId(
  windowId: string | null,
  getSources: GetSources
): Promise<string> {
  if (!windowId) throw new Error(SOURCE_NOT_FOUND)
  let sources: { id: string }[]
  try {
    sources = await getSources(['window'])
  } catch (e) {
    console.warn('[slideshow] window list failed:', e instanceof Error ? e.message : e)
    throw new Error(SOURCE_NOT_FOUND)
  }
  const id = sourceIdForWindow(sources, windowId)
  if (!id) throw new Error(SOURCE_NOT_FOUND)
  return id
}
