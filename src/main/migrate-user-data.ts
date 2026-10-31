import fs from 'node:fs'
import path from 'node:path'

/**
 * The app was renamed from PPT Share to Bridgecast, which changes Electron's default data folder.
 * If the new folder does not exist yet and an old one does, move the old one so the library
 * (events, decks, settings) follows the rename. Returns the folder that was moved, or null.
 */
export function migrateUserData(
  newDir: string,
  appDataDir: string,
  oldNames: readonly string[] = ['PPT Share', 'ppt-share']
): string | null {
  if (fs.existsSync(newDir)) return null
  for (const name of oldNames) {
    const old = path.join(appDataDir, name)
    if (path.resolve(old) === path.resolve(newDir)) continue
    if (!fs.existsSync(old)) continue
    try {
      fs.renameSync(old, newDir)
      return old
    } catch {
      return null
    }
  }
  return null
}
