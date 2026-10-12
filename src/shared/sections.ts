import type { SectionMeta } from './types'

/** One row of an event's ordered list: a deck id or a section id. */
export type OrderItem = { deck: string } | { section: string }

const clampAt = (at: number, max: number): number => Math.min(Math.max(at, 0), max)

/**
 * Interleaves deck ids with section dividers. A section goes before `deckIds[at]`;
 * sections sharing an `at` keep their array order; `at === deckIds.length` goes last.
 */
export function orderItems(deckIds: string[], sections: SectionMeta[] = []): OrderItem[] {
  const items: OrderItem[] = []
  const placed = (i: number): void => {
    for (const s of sections) if (clampAt(s.at, deckIds.length) === i) items.push({ section: s.id })
  }
  deckIds.forEach((id, i) => {
    placed(i)
    items.push({ deck: id })
  })
  placed(deckIds.length)
  return items
}

/**
 * Inverse of orderItems: derives deck order and each section's `at` from item positions.
 * Names and ids come from `sections`. Does not validate; callers do.
 */
export function splitOrder(
  items: OrderItem[],
  sections: SectionMeta[]
): { deckIds: string[]; sections: SectionMeta[] } {
  const byId = new Map(sections.map((s) => [s.id, s]))
  const deckIds: string[] = []
  const out: SectionMeta[] = []
  for (const item of items) {
    if ('deck' in item) deckIds.push(item.deck)
    else {
      const s = byId.get(item.section)
      if (s) out.push({ ...s, at: deckIds.length })
    }
  }
  return { deckIds, sections: out }
}

/**
 * Cleans untrusted section data: drops non-objects, non-string or duplicate ids and
 * empty names, clamps `at` to an integer in 0..deckCount, then stable-sorts by `at`.
 */
export function sanitizeSections(raw: unknown, deckCount: number): SectionMeta[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SectionMeta[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const { id, name, at } = r as Record<string, unknown>
    if (typeof id !== 'string' || seen.has(id)) continue
    if (typeof name !== 'string' || name === '') continue
    seen.add(id)
    const n = typeof at === 'number' && Number.isFinite(at) ? Math.trunc(at) : 0
    out.push({ id, name, at: clampAt(n, deckCount) })
  }
  return out.sort((a, b) => a.at - b.at)
}

export interface Segment<D> {
  /** null for the leading block of decks before the first section. */
  section: SectionMeta | null
  decks: D[]
}

/**
 * Splits decks into the leading block (only if non-empty) and one segment per
 * section, empty ones included. `at` is clamped into 0..decks.length.
 */
export function segmentsOf<D>(decks: D[], sections: SectionMeta[] = []): Segment<D>[] {
  const ats = sections.map((s) => clampAt(s.at, decks.length))
  const segments: Segment<D>[] = []
  const lead = decks.slice(0, ats.length ? Math.min(...ats) : decks.length)
  if (lead.length) segments.push({ section: null, decks: lead })
  sections.forEach((s, i) => {
    const end = ats.slice(i + 1).find((a) => a >= ats[i]) ?? decks.length
    segments.push({ section: s, decks: decks.slice(ats[i], end) })
  })
  return segments
}
