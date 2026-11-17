import * as fs from 'node:fs'

/**
 * Diagnostics for web decks (helper lifecycle, page loads, capture, frames, HOLD). The app
 * has no console when it is installed, so the lines also go to `<userData>/web.log`
 * (rotated once at 1 MB). Main calls `setWebLogFile` at startup; tests leave it unset.
 */
let logFile: string | null = null

export function setWebLogFile(file: string | null): void {
  logFile = file
}

export function webLog(message: string): void {
  console.log('[web]', message)
  if (!logFile) return
  const line = `${new Date().toISOString()} ${message}\n`
  try {
    fs.appendFileSync(logFile, line)
    if (fs.statSync(logFile).size > 1024 * 1024) {
      fs.renameSync(logFile, `${logFile}.1`)
    }
  } catch {
    // A log that cannot be written must never break the show.
  }
}
