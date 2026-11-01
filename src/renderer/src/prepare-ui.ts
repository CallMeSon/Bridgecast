/** Pure rules for the Prepare window (kept out of the component so they can be tested). */

/** The address field shows what the operator typed while editing, else the page's own URL. */
export function addressShown(a: {
  pageUrl: string | null
  typed: string
  editing: boolean
}): string {
  if (a.editing) return a.typed
  return a.pageUrl ?? a.typed
}

function bare(url: string): string {
  const t = url.trim()
  return t.endsWith('/') ? t.slice(0, -1) : t
}

/** Home goes to the deck address; it has nothing to do when the page is already there. */
export function homeDisabled(pageUrl: string | null, deckUrl: string | undefined): boolean {
  if (!deckUrl) return true
  return pageUrl !== null && bare(pageUrl) === bare(deckUrl)
}
