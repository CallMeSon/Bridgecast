// Home (event browser) list logic. Pure.
import type { EventMeta, EventSummary } from '../../shared/types'

export type HomeTab = 'recent' | 'all' | 'archive'
export type HomeFilter = 'all' | 'live' | 'web' | 'empty'
export const RECENT_MAX = 12

export const FILTER_LABEL: Record<HomeFilter, string> = {
  all: 'Filter',
  live: 'On air',
  web: 'With web pages',
  empty: 'No decks yet'
}

export interface HomeOptions {
  tab: HomeTab
  filter: HomeFilter
  query: string
  airEvent: string | null
  onAir: boolean
}

export function homeList(
  events: EventMeta[],
  summaries: EventSummary[],
  o: HomeOptions
): EventMeta[] {
  const sum = new Map(summaries.map((s) => [s.id, s]))
  const q = o.query.trim().toLowerCase()
  let list = events.map((ev, order) => ({ ev, order }))
  if (o.tab === 'recent') list = list.filter((x) => !x.ev.archived)
  else if (o.tab === 'archive') list = list.filter((x) => x.ev.archived)
  if (o.filter === 'live') list = list.filter((x) => o.onAir && x.ev.id === o.airEvent)
  else if (o.filter === 'web') list = list.filter((x) => sum.get(x.ev.id)?.hasWeb === true)
  else if (o.filter === 'empty') {
    list = list.filter((x) => (sum.get(x.ev.id)?.deckCount ?? x.ev.deckIds.length) === 0)
  }
  if (q) {
    list = list.filter(
      (x) =>
        x.ev.name.toLowerCase().includes(q) ||
        (sum.get(x.ev.id)?.deckNames ?? []).some((n) => n.toLowerCase().includes(q))
    )
  }
  list.sort(
    (a, b) =>
      (b.ev.lastOpened ?? 0) - (a.ev.lastOpened ?? 0) ||
      (b.ev.createdAt ?? 0) - (a.ev.createdAt ?? 0) ||
      a.order - b.order
  )
  const out = list.map((x) => x.ev)
  if (o.onAir && o.airEvent) {
    const at = out.findIndex((e) => e.id === o.airEvent)
    if (at > 0) out.unshift(...out.splice(at, 1))
  }
  return o.tab === 'recent' ? out.slice(0, RECENT_MAX) : out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function day(t: number): string {
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function eventSubLine(ev: EventMeta, s: EventSummary | undefined, now: number): string {
  const n = s?.deckCount ?? ev.deckIds.length
  const count = n === 0 ? 'No decks yet' : n === 1 ? '1 deck' : `${n} decks`
  let tail = ''
  if (ev.archived) tail = 'Archived'
  else if (ev.lastOpened !== undefined) {
    const t = ev.lastOpened
    const d = new Date(t)
    const days = Math.round((dayStart(new Date(now)) - dayStart(d)) / 86_400_000)
    if (now - t >= 0 && now - t < 60_000) tail = 'Opened this minute'
    else if (days === 0) tail = `Opened today, ${clock(d)}`
    else if (days === 1) tail = `Opened yesterday, ${clock(d)}`
    else tail = `Opened ${day(t)}`
  } else if (ev.createdAt !== undefined) tail = `Created ${day(ev.createdAt)}`
  return tail ? `${count} · ${tail}` : count
}

export type HomeLayout = 'grid' | 'list'
export interface HomePrefs {
  tab: HomeTab
  filter: HomeFilter
  layout: HomeLayout
}
const PREFS_KEY = 'home-view'
export const DEFAULT_HOME_PREFS: HomePrefs = { tab: 'recent', filter: 'all', layout: 'grid' }

/** Reads the saved Home tab, filter and layout; anything missing or wrong falls back. */
export function loadHomePrefs(storage: Pick<Storage, 'getItem'> | null): HomePrefs {
  try {
    const raw = storage?.getItem(PREFS_KEY)
    const o: unknown = raw ? JSON.parse(raw) : null
    const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
    return {
      tab: r.tab === 'all' || r.tab === 'archive' || r.tab === 'recent' ? r.tab : 'recent',
      filter:
        r.filter === 'live' || r.filter === 'web' || r.filter === 'empty' || r.filter === 'all'
          ? r.filter
          : 'all',
      layout: r.layout === 'list' ? 'list' : 'grid'
    }
  } catch {
    return { ...DEFAULT_HOME_PREFS }
  }
}

export function saveHomePrefs(storage: Pick<Storage, 'setItem'> | null, p: HomePrefs): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // Private mode or blocked storage: the choice just is not kept.
  }
}
