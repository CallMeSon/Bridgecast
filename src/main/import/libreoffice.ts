import type { ImportedDeck } from './pptx'

/** What the LibreOffice import is asked to do. */
export interface LibreOfficeImportOptions {
  /** `odp`: convert the file to a LibreOffice presentation (.odp) and use that as the working copy. */
  format: 'odp' | 'original'
}

/** Replaced by the real import in the LibreOffice import task. */
export async function importPptxLibreOffice(
  ...args: [file: string, outDir: string, width: number, opts: LibreOfficeImportOptions]
): Promise<ImportedDeck & { warning?: string }> {
  void args
  throw new Error('LibreOffice import is not available yet.')
}
