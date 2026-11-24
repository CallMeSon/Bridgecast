import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import path from 'node:path'

export const NO_MAC_CONVERTER =
  'Install Keynote (free from the App Store) or LibreOffice to import PowerPoint files, or export the file to PDF and import the PDF.'
export const KEYNOTE_DENIED =
  'Bridgecast is not allowed to control Keynote. Allow it in System Settings > Privacy & Security > Automation, then import again.'
export const CONVERT_FAILED =
  'The PowerPoint file could not be converted to PDF. Export it to PDF from PowerPoint or Keynote and import the PDF.'

export const KEYNOTE_APP = '/Applications/Keynote.app'
export const SOFFICE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice'
]
export const CONVERT_TIMEOUT_MS = 180_000

/** Paths come in as argv (`on run argv`), never spliced into the script. */
export const KEYNOTE_SCRIPT = `on run argv
  set inFile to POSIX file (item 1 of argv)
  set outFile to POSIX file (item 2 of argv)
  set wasRunning to application "Keynote" is running
  tell application "Keynote"
    set theDoc to open inFile
    try
      export theDoc to outFile as PDF with properties {image quality:Best}
    on error errMsg number errNum
      close theDoc saving no
      if not wasRunning then quit
      error errMsg number errNum
    end try
    close theDoc saving no
    if not wasRunning then quit
  end tell
end run`

export const keynoteArgs = (file: string, outPdf: string): string[] => [
  '-e',
  KEYNOTE_SCRIPT,
  file,
  outPdf
]

export const sofficeArgs = (file: string, outDir: string): string[] => [
  '--headless',
  '--convert-to',
  'pdf',
  '--outdir',
  outDir,
  file
]

/** osascript error -1743: the user refused (or never allowed) Apple events to Keynote. */
export const isAutomationDenied = (err: unknown): boolean =>
  /-1743|not authorized to send apple events/i.test(String((err as Error)?.message ?? err))

export interface MacConvertDeps {
  exists(p: string): boolean
  /** Runs a program; rejects with its stderr as the message (also on timeout). */
  run(cmd: string, args: string[], timeoutMs: number): Promise<void>
}

export const macConvertDeps: MacConvertDeps = {
  exists: (p) => fs.existsSync(p),
  run: (cmd, args, timeoutMs) =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, _out, stderr) =>
        err ? reject(new Error(String(stderr || err.message))) : resolve()
      )
    })
}

/**
 * Converts a PowerPoint file to `<outDir>/<name>.pdf` on macOS: Keynote first, then LibreOffice.
 * Resolves with the PDF path; throws an operator message when nothing could convert it.
 */
export async function convertPptxToPdf(
  file: string,
  outDir: string,
  deps: MacConvertDeps = macConvertDeps
): Promise<string> {
  const pdf = path.join(outDir, `${path.basename(file).replace(/\.[^.]*$/, '')}.pdf`)
  const soffice = SOFFICE_PATHS.find((p) => deps.exists(p))
  const hasKeynote = deps.exists(KEYNOTE_APP)
  if (!hasKeynote && !soffice) throw new Error(NO_MAC_CONVERTER)
  let denied = false
  const attempt = async (cmd: string, args: string[]): Promise<boolean> => {
    try {
      await deps.run(cmd, args, CONVERT_TIMEOUT_MS)
      return deps.exists(pdf)
    } catch (err) {
      if (cmd === 'osascript' && isAutomationDenied(err)) denied = true
      return false
    }
  }
  if (hasKeynote && (await attempt('osascript', keynoteArgs(file, pdf)))) return pdf
  // soffice names its output after the input file, which is what `pdf` is.
  if (soffice && (await attempt(soffice, sofficeArgs(file, outDir)))) return pdf
  throw new Error(denied ? KEYNOTE_DENIED : CONVERT_FAILED)
}
