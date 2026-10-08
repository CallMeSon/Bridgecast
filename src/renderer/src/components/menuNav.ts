import type { KeyboardEvent } from 'react'
import { menuFocusTarget } from '../model'

/** Enabled items of a menu, in DOM order. */
export function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')]
}

/**
 * Roving focus for a `role="menu"`: ArrowUp/ArrowDown/Home/End move between its
 * enabled items. Attach as `onKeyDown` on the menu element.
 */
export function onMenuKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const items = menuItems(e.currentTarget)
  const to = menuFocusTarget(
    e.key,
    items.indexOf(document.activeElement as HTMLElement),
    items.length
  )
  if (to === null) return
  e.preventDefault()
  items[to].focus()
}
