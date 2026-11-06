/**
 * Indexes of the tabs not fully inside the view [viewLeft, viewRight]. Edges are inclusive:
 * a tab that fits exactly counts as visible.
 */
export function hiddenTabs(
  tabs: { left: number; right: number }[],
  viewLeft: number,
  viewRight: number
): number[] {
  const out: number[] = []
  tabs.forEach((t, i) => {
    if (t.left < viewLeft || t.right > viewRight) out.push(i)
  })
  return out
}

/**
 * Scroll padding that keeps a chosen tab clear of the sticky on-air tab: the on-air tab's
 * width plus the 2 px gap, but never so much that the chosen tab no longer fits in the rest
 * of the list. Floored at 0.
 */
export function stickyPadding(liveWidth: number, listWidth: number, chosenWidth: number): number {
  return Math.max(0, Math.min(liveWidth + 2, listWidth - chosenWidth))
}
