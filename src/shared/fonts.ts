/** Names of fonts that are theme placeholders (`+mn-lt`, `+mj-ea`, ...), not real fonts. */
const isPlaceholder = (name: string): boolean => name.startsWith('+')

/**
 * Fonts a deck uses that are not installed. Names are compared case-insensitively and listed once
 * (first spelling kept), sorted. Aliases are kept literal: Calibri stays missing even when Carlito,
 * its metric-compatible replacement, is installed (the warning tells the user about Carlito).
 */
export function missingFonts(used: string[], installed: string[]): string[] {
  const have = new Set(installed.map((f) => f.trim().toLowerCase()))
  const seen = new Map<string, string>()
  for (const raw of used) {
    const name = raw.trim()
    if (!name || isPlaceholder(name)) continue
    const key = name.toLowerCase()
    if (!have.has(key) && !seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

/** The import warning for missing fonts, or null when none are missing. */
export function fontWarning(missing: string[]): string | null {
  if (missing.length === 0) return null
  return `This deck uses fonts that are not installed: ${missing.join(', ')}. The layout may shift. Install them, or the metric-compatible Carlito, Caladea or Liberation fonts.`
}

/** Family names from the output of `fc-list : family` (one font per line, aliases comma separated). */
export function parseFcList(output: string): string[] {
  const out: string[] = []
  for (const line of output.split(/\r?\n/)) {
    for (const part of line.split(/(?<!\\),/)) {
      const name = part.replace(/\\(.)/g, '$1').trim()
      if (name) out.push(name)
    }
  }
  return out
}
