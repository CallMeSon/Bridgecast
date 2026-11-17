import { app, type Session } from 'electron'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * Ad and tracker blocking for the web deck profile (`persist:web`) only. The filter lists come
 * from Ghostery and are cached in the user data folder, so the engine loads fast and still works
 * offline after the first run. It is best effort: any failure (no network on first run, a bad
 * cache) leaves the pages unblocked and never touches the show. Set `PPT_ADBLOCK=0` to turn it off.
 */
export function startAdBlock(ses: Session): void {
  if (process.env['PPT_ADBLOCK'] === '0') return
  const path = join(app.getPath('userData'), 'adblock-engine.bin')
  ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path,
    read: fs.readFile,
    write: fs.writeFile
  })
    .then((blocker) => {
      blocker.enableBlockingInSession(ses)
    })
    .catch((err: unknown) => {
      console.warn('[web] ad blocker unavailable:', err instanceof Error ? err.message : err)
    })
}
