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
