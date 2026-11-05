import { useEffect, type KeyboardEvent, type RefObject } from 'react'
import { menuFocusTarget } from '../model'

/** Enabled items of a menu (plain and radio items, also inside groups), in DOM order. */
export function menuItems(menu: HTMLElement): HTMLElement[] {
  return [
    ...menu.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'
    )
  ]
}

/** Top for a menu `height` tall opened at `top`: shifted up to stay 8 px inside the viewport. */
export function fitMenuTop(top: number, height: number, viewport: number): number {
  const margin = 8
  return Math.max(margin, Math.min(top, viewport - margin - height))
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

/**
 * Right-click menu lifecycle: focuses the first item, and closes on Escape, outside
 * click, blur or resize. Escape first hands focus back to the row matching `rowSelector`.
 */
export function useContextMenu(
  ref: RefObject<HTMLElement | null>,
  rowSelector: string,
  onClose: () => void
): void {
  useEffect(() => {
    menuItems(ref.current!)[0]?.focus()
    const close = (e: Event): void => {
      if (e.type === 'keydown') {
        if ((e as globalThis.KeyboardEvent).key !== 'Escape') return
        document.querySelector<HTMLElement>(rowSelector)?.focus()
      }
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    addEventListener('pointerdown', close, true)
    addEventListener('keydown', close, true)
    addEventListener('blur', close)
    addEventListener('resize', close)
    return () => {
      removeEventListener('pointerdown', close, true)
      removeEventListener('keydown', close, true)
      removeEventListener('blur', close)
      removeEventListener('resize', close)
    }
  }, [ref, rowSelector, onClose])
}
