import { execFile } from 'node:child_process'
import path from 'node:path'
import { fontWarning, missingFonts, parseFcList } from '../../shared/fonts'
import type { PptImportFormat } from '../../shared/settings'
import type { ImportedDeck } from './pptx'

/** What the LibreOffice import is asked to do. */
export interface LibreOfficeImportOptions {
  /**
   * `odp`: convert the PowerPoint file to a LibreOffice presentation (.odp) and use that as the
   * working copy (`source.odp`); `original`: keep the file as it was imported. The file the user
   * imported is stored untouched as `original.<ext>` either way.
   */
  format: PptImportFormat
}

/** The reply of the bridge's `import` command, validated. */
export interface BridgeImport {
  name: string
  width: number
  height: number
  pdf: string
  pngs: string[]
  notes: string[]
  clicks: number[]
  hidden: boolean[]
  isStatic: boolean
  fonts: string[]
  /** The file the slide show will play: the .odp copy, or the imported file itself. */
  source: string
}

/** What the import needs from the running LibreOffice bridge and from the system. */
export interface LibreOfficeDeps {
  /** The bridge `import` command (the bridge starts LibreOffice when it is needed). */
  bridgeImport(req: {
    path: string
    outDir: string
    width: number
    format: PptImportFormat
  }): Promise<Record<string, unknown>>
  /** Installed font families (`fc-list : family`). */
  installedFonts(): Promise<string[]>
}

const num = (x: unknown): number =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0

function padded<T>(v: unknown, n: number, fill: T, pick: (x: unknown) => T): T[] {
  const arr = Array.isArray(v) ? v : []
  return Array.from({ length: n }, (_, i) => (i < arr.length ? pick(arr[i]) : fill))
}

/** Validates the bridge reply; arrays are padded or cut to the number of slide images. */
export function parseBridgeImport(raw: Record<string, unknown>): BridgeImport {
  const pngs = (Array.isArray(raw.pngs) ? raw.pngs : []).filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  )
  if (pngs.length === 0) {
    throw new Error('No slides were exported. Make sure the file contains slides, then try again.')
  }
  const n = pngs.length
  const str = (x: unknown): string => (typeof x === 'string' ? x : '')
  if (typeof raw.source !== 'string' || !raw.source) {
    throw new Error('The LibreOffice import result could not be read. Try again.')
  }
  return {
    name: str(raw.name),
    width: num(raw.width),
    height: num(raw.height),
    pdf: str(raw.pdf),
    pngs,
    notes: padded(raw.notes, n, '', str),
    clicks: padded(raw.clicks, n, 0, num),
    hidden: padded(raw.hidden, n, false, (x) => x === true),
    isStatic: raw.isStatic === true,
    fonts: (Array.isArray(raw.fonts) ? raw.fonts : []).filter(
      (f): f is string => typeof f === 'string'
    ),
    source: raw.source
  }
}

/**
 * PowerPoint import on Linux: the bridge opens the file hidden in the app's own LibreOffice, saves
 * the .odp when asked, and writes the slide PNGs (LibreOffice's own graphic export, not pdf.js:
 * main has no canvas and the PNGs match the slide show this way), `source.pdf`, notes, clicks,
 * hidden and static. Missing fonts are listed once in `warning`.
 */
export async function importPptxLibreOffice(
  file: string,
  outDir: string,
  width: number,
  opts: LibreOfficeImportOptions,
  deps: LibreOfficeDeps
): Promise<ImportedDeck & { warning?: string }> {
  // A file that already is an .odp (an edit of a converted deck) is never converted again.
  const format: PptImportFormat =
    path.extname(file).toLowerCase() === '.odp' ? 'original' : opts.format
  const r = parseBridgeImport(await deps.bridgeImport({ path: file, outDir, width, format }))
  // No font list (fontconfig missing): say nothing rather than call every font missing.
  const installed = r.fonts.length ? await deps.installedFonts() : []
  const warning = installed.length ? fontWarning(missingFonts(r.fonts, installed)) : null
  const converted = r.source !== file
  return {
    name: path.basename(file).replace(/\.(pptx?|odp)$/i, ''),
    width: r.width || width,
    height: r.height || Math.round((width * 3) / 4),
    slides: r.pngs.map((pngPath, i) => ({
      pngPath,
      notes: r.notes[i],
      clicks: r.clicks[i],
      hidden: r.hidden[i]
    })),
    pdfPath: r.pdf,
    isStatic: r.isStatic,
    sourcePath: r.source,
    ...(converted ? { originalPath: file, converted: true } : {}),
    ...(warning ? { warning } : {})
  }
}

/** Installed font families from `fc-list : family`; empty when fontconfig is missing (no warning then). */
export function installedFonts(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      execFile('fc-list', [':', 'family'], { timeout: 15_000, maxBuffer: 16 << 20 }, (err, out) =>
        resolve(err ? [] : parseFcList(String(out)))
      )
    } catch {
      resolve([])
    }
  })
}
