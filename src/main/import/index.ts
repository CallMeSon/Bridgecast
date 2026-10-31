import type { EngineInfo } from '../platform'
import { importPptxLibreOffice, type LibreOfficeImportOptions } from './libreoffice'
import { importPptxPowerPoint, type ImportedDeck } from './pptx'

export type { ImportedDeck } from './pptx'

/** What the import needs to know about this computer (set once at start, injectable in tests). */
export interface ImportEnv {
  engine: Pick<EngineInfo, 'engine' | 'message'>
  /** Linux: what to do with the imported PowerPoint file (see `PptImportFormat`). */
  format: () => LibreOfficeImportOptions['format']
  powerPoint: typeof importPptxPowerPoint
  libreOffice: typeof importPptxLibreOffice
}

let env: ImportEnv | null = null

/** Called once at start with the detected engine and the saved Linux format. */
export function configureImport(e: {
  engine: ImportEnv['engine']
  format: ImportEnv['format']
}): void {
  env = { ...e, powerPoint: importPptxPowerPoint, libreOffice: importPptxLibreOffice }
}

/**
 * Imports a PPT/PPTX with the program of this platform: PowerPoint on Windows, LibreOffice on
 * Linux. Both give the same deck shape (PNGs, `source.pdf`, notes, clicks, hidden, static). With
 * no engine the install message is thrown, so the row reports it.
 */
export async function importPptx(
  file: string,
  outDir: string,
  width: number,
  override?: ImportEnv
): Promise<ImportedDeck & { warning?: string }> {
  const e = override ?? env
  if (!e) throw new Error('The import is not ready yet. Try again in a moment.')
  if (e.engine.engine === 'powerpoint') return e.powerPoint(file, outDir, width)
  if (e.engine.engine === 'libreoffice') {
    return e.libreOffice(file, outDir, width, { format: e.format() })
  }
  throw new Error(e.engine.message ?? 'PowerPoint files cannot be imported on this computer.')
}
