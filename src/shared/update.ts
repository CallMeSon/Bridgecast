import type { ProgramState } from './program'

export type UpdateStatus =
  /** `checkFailed`: the last check could not reach the release (offline, rate limit). */
  | { kind: 'idle'; checkFailed?: boolean }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; percent: number; notes?: string }
  | { kind: 'ready'; version: string; notes?: string }
  | { kind: 'error'; version: string; message: string; notes?: string }
  /** This build cannot self-update (dev build, .deb, macOS): no update UI is shown. */
  | { kind: 'unsupported' }

/** Shared status for builds without an update engine, so callers cannot drift. */
export const UNSUPPORTED_UPDATE_STATUS: UpdateStatus = Object.freeze({ kind: 'unsupported' })

/** Release notes of the announced version; they travel with it from available to ready. */
export function updateNotes(status: UpdateStatus): string {
  return 'notes' in status ? (status.notes ?? '') : ''
}

export function isUpdateSupported(status: UpdateStatus): boolean {
  return status.kind !== 'unsupported'
}

export interface UpdateSettings {
  skippedVersion: string | null
}

export const DEFAULT_UPDATES: Readonly<UpdateSettings> = Object.freeze({ skippedVersion: null })

type ParsedVersion = { numbers: number[]; prerelease: string[] | null }

function parseVersion(input: string): ParsedVersion | null {
  const match =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      input
    )
  if (!match) return null
  const numbers = match.slice(1, 4).map(Number)
  if (!numbers.every(Number.isSafeInteger)) return null
  const prerelease = match[4]?.split('.') ?? null
  if (prerelease?.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    return null
  }
  return { numbers, prerelease }
}

function comparePrerelease(a: string[] | null, b: string[] | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1
    if (b[i] === undefined) return 1
    if (a[i] === b[i]) continue
    const aNumeric = /^\d+$/.test(a[i])
    const bNumeric = /^\d+$/.test(b[i])
    if (aNumeric && bNumeric) return Number(a[i]) < Number(b[i]) ? -1 : 1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a[i] < b[i] ? -1 : 1
  }
  return 0
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return false
  for (let i = 0; i < 3; i++) {
    if (next.numbers[i] !== installed.numbers[i]) return next.numbers[i] > installed.numbers[i]
  }
  return comparePrerelease(next.prerelease, installed.prerelease) > 0
}

/** True for a valid version carrying a pre-release suffix; invalid input is not pre-release. */
export function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version)
  return parsed !== null && parsed.prerelease !== null
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

/**
 * GitHub serves release notes as HTML. Turns that into the plain markdown-like text
 * `releaseNotesLines` reads (headings, bullets, paragraphs); text without tags is returned as is.
 */
export function releaseNotesText(notes: string): string {
  if (!/<[a-z][^>]*>/i.test(notes)) return notes
  return notes
    .replace(/\r?\n/g, ' ')
    .replace(/<h[1-6][^>]*>/gi, '\n### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(?:h[1-6]|p|li|ul|ol|div)>|<br\s*\/?>|<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITIES[entity])
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export type ReleaseNotesLine = { kind: 'heading' | 'bullet' | 'paragraph'; text: string }

function plainText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '').trim()
}

export function releaseNotesLines(markdown: string): ReleaseNotesLine[] {
  const lines: ReleaseNotesLine[] = []
  for (const raw of markdown.split(/\r?\n/)) {
    if (!raw.trim()) continue
    const heading = /^\s*#+\s+(.*)$/.exec(raw)
    if (heading) {
      lines.push({ kind: 'heading', text: plainText(heading[1]) })
      continue
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw)
    if (bullet) {
      lines.push({ kind: 'bullet', text: plainText(bullet[1]) })
      continue
    }
    if (/^\s+/.test(raw) && lines.at(-1)?.kind === 'bullet') {
      lines[lines.length - 1].text = plainText(`${lines[lines.length - 1].text} ${raw.trim()}`)
      continue
    }
    lines.push({ kind: 'paragraph', text: plainText(raw) })
  }
  return lines
}

/** Nothing the operator put on air: no slide shown and no key visual pressed (STANDBY may show the KV by itself). */
export function canInstallNow(state: ProgramState): boolean {
  return state.shown === null && !state.kv
}

export function sanitizeUpdates(raw: unknown): UpdateSettings {
  const settings =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  return {
    skippedVersion:
      typeof settings.skippedVersion === 'string'
        ? settings.skippedVersion
        : DEFAULT_UPDATES.skippedVersion
  }
}
