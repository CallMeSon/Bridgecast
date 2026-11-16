import type { ProgramState } from './program'

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; version: string; message: string }

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

export function canInstallNow(state: ProgramState): boolean {
  return state.shown === null
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
