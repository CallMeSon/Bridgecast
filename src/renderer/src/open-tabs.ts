// Open event tabs in the operator header (pure). Tabs live for one run: the app starts on Home
// with none open.

export const MAX_TABS = 8

/** Adds `id` at the end. Over the cap, drops the oldest id that is not in `keep` (nor `id`). */
export function openTab(ids: string[], id: string, keep: (string | null)[]): string[] {
  if (ids.includes(id)) return ids
  const next = [...ids, id]
  while (next.length > MAX_TABS) {
    const drop = next.findIndex((x) => x !== id && !keep.includes(x))
    if (drop < 0) break
    next.splice(drop, 1)
  }
  return next
}

/** `next` is the tab to select: the left neighbour of a closed current tab, else the first,
 *  else null (show Home). Closing another tab leaves the current one. `locked` (the event on
 *  air) cannot be closed: nothing changes. */
export function closeTab(
  ids: string[],
  id: string,
  current: string | null,
  locked: string | null = null
): { ids: string[]; next: string | null } {
  if (id === locked) return { ids, next: current }
  const at = ids.indexOf(id)
  if (at < 0) return { ids, next: current }
  const rest = ids.filter((x) => x !== id)
  if (id !== current) return { ids: rest, next: current }
  return { ids: rest, next: at > 0 ? ids[at - 1] : (rest[0] ?? null) }
}

/** The event on air always has a tab: when it is missing (and on air), it is opened again,
 *  dropping the oldest other tab over the cap. Off air or already open: `ids` unchanged. */
export function keepAirTab(ids: string[], air: string | null, onAir: boolean): string[] {
  if (!onAir || !air || ids.includes(air)) return ids
  return openTab(ids, air, [air])
}
