import { useEffect, useRef, useState } from 'react'
import { CaretDownIcon, PlusIcon, SquaresFourIcon, XIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import type { Tally } from '../model'
import { onMenuKeyDown, menuItems } from './menuNav'
import { StatusTag } from './StatusTag'
import { stickyPadding } from './tab-overflow'

interface Props {
  events: EventMeta[]
  /** Open tab ids, in order. */
  ids: string[]
  current: string | null
  view: 'console' | 'home'
  /** The event the output belongs to. */
  airEvent: string | null
  /** What the output shows; the air event's tab carries its tag unless this is idle. */
  airState: Tally
  onSelect(id: string): void
  onClose(id: string): void
  onHome(): void
  /** Opens the New event dialog. */
  onNew(): void
}

/**
 * The left of the header: Home, the open-event tabs, New. Closing a tab only removes the
 * tab (the caller never touches the output). Only the tab list shrinks; long names cut with
 * an ellipsis and the live tag stays.
 */
export function EventTabs({
  events,
  ids,
  current,
  view,
  airEvent,
  airState,
  onSelect,
  onClose,
  onHome,
  onNew
}: Props): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const tabs = ids.flatMap((id) => events.find((e) => e.id === id) ?? [])
  const selected = view === 'console' ? current : null
  // Roving tabindex: the selected tab, else the first one, is the stop for Tab.
  const stop = tabs.some((t) => t.id === selected) ? selected : (tabs[0]?.id ?? null)

  useEffect(() => {
    const el = list.current
    const sel = el?.querySelector('[aria-selected=true]')
    if (!el || !sel) return
    // The on-air tab is sticky at one edge: at the left when the chosen tab comes after it,
    // at the right when it comes before. Keep the chosen tab clear of that edge only.
    const all = Array.from(el.querySelectorAll('.otab'))
    const liveAt = all.findIndex((t) => t.hasAttribute('data-live'))
    const at = all.indexOf(sel.parentElement as Element)
    const pad =
      liveAt < 0 || liveAt === at
        ? 0
        : stickyPadding(
            all[liveAt].getBoundingClientRect().width,
            el.clientWidth,
            all[at].getBoundingClientRect().width
          )
    el.style.scrollPaddingLeft = liveAt >= 0 && at > liveAt ? `${pad}px` : '0'
    el.style.scrollPaddingRight = liveAt >= 0 && at < liveAt ? `${pad}px` : '0'
    // The whole tab (its close button too), not just the name button.
    sel.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected, ids.length])

  // The All open events button appears while any tab is cut off by the list's edges.
  useEffect(() => {
    const el = list.current
    if (!el) return
    const measure = (): void => {
      // The list scrolls when its tabs do not fit; a tab under the sticky on-air one counts too.
      // One pixel of slack: subpixel layout must not read as a cut-off tab.
      const over = el.scrollWidth > el.clientWidth + 1
      setOverflowing(over)
      // The trigger is gone: the menu goes with it and stays closed when overflow returns.
      if (!over) setMenuOpen(false)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [ids.length, events])

  useEffect(() => {
    if (!menuOpen || !overflowing) return
    const items = menuRef.current ? menuItems(menuRef.current) : []
    ;(items.find((i) => i.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
    const close = (e: Event): void => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key !== 'Escape') return
        trigger.current?.focus()
      } else if (
        // A resize targets the window, not a node: it falls through and closes the menu.
        e.target instanceof Node &&
        (menuRef.current?.contains(e.target) || trigger.current?.contains(e.target))
      )
        return
      setMenuOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
    }
  }, [menuOpen, overflowing])

  // A vertical wheel over the list scrolls it sideways.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
  }

  const tabButtons = (): HTMLElement[] =>
    Array.from(list.current?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Arrows move between tabs and Space selects one: neither may also take the next slide
    // live. Other console keys (F, B, K, PageDown) still work after a click on a tab.
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ') e.stopPropagation()
    const items = tabButtons()
    const at = items.indexOf(e.target as HTMLElement)
    if (at < 0) return
    let to = -1
    if (e.key === 'ArrowRight') to = (at + 1) % items.length
    else if (e.key === 'ArrowLeft') to = (at - 1 + items.length) % items.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = items.length - 1
    else if (e.key === 'Delete') {
      e.preventDefault()
      const id = tabs[at]?.id
      // The on-air tab cannot be closed: Delete does nothing on it, as there is no ×.
      if (id && !(id === airEvent && airState !== 'idle')) onClose(id)
      return
    }
    if (to < 0) return
    e.preventDefault()
    items[to].focus()
  }

  return (
    <div className="evtabs">
      <span className="hsep" />
      <button
        className="homebtn"
        aria-pressed={view === 'home'}
        aria-label="Events home"
        title="Events home"
        data-testid="home-btn"
        onClick={onHome}
      >
        <SquaresFourIcon size={18} />
      </button>
      <span className="hsep" />
      <div
        ref={list}
        className="tabsbar"
        role="tablist"
        aria-label="Open events"
        onKeyDown={onKeyDown}
        onWheel={onWheel}
      >
        {tabs.map((ev) => {
          const live = ev.id === airEvent && airState !== 'idle'
          const isSel = ev.id === selected
          const isStop = ev.id === stop
          return (
            <div
              key={ev.id}
              className="otab"
              role="presentation"
              data-selected={isSel || undefined}
              data-live={live || undefined}
            >
              <button
                role="tab"
                className="otab-main"
                aria-selected={isSel}
                aria-label={live ? `${ev.name}, on air` : ev.name}
                title={live ? `${ev.name}, on air. Take it off air first.` : ev.name}
                tabIndex={isStop ? 0 : -1}
                onClick={() => onSelect(ev.id)}
              >
                <span className="tn">{ev.name}</span>
                {live && (
                  <StatusTag kind={airState as Exclude<Tally, 'idle'>} variant="icon" size="sm" />
                )}
              </button>
              {!live && (
                <button
                  className="x"
                  aria-label={`Close ${ev.name}`}
                  title="Close tab"
                  tabIndex={isStop ? 0 : -1}
                  onClick={() => onClose(ev.id)}
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {overflowing && (
        <button
          ref={trigger}
          className="tab-overflow"
          data-testid="tab-overflow"
          aria-label="All open events"
          title="All open events"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <CaretDownIcon size={16} />
        </button>
      )}
      {menuOpen && overflowing && (
        <div
          ref={menuRef}
          className="menu tab-menu"
          role="menu"
          aria-label="All open events"
          data-no-shortcuts
          onKeyDown={onMenuKeyDown}
        >
          {tabs.map((ev) => {
            const live = ev.id === airEvent && airState !== 'idle'
            return (
              <button
                key={ev.id}
                role="menuitemradio"
                aria-checked={ev.id === selected}
                aria-label={live ? `${ev.name}, on air` : ev.name}
                onClick={() => {
                  setMenuOpen(false)
                  onSelect(ev.id)
                }}
              >
                <span className="tn">{ev.name}</span>
                {live && (
                  <StatusTag kind={airState as Exclude<Tally, 'idle'>} variant="icon" size="sm" />
                )}
              </button>
            )
          })}
        </div>
      )}
      <button className="newbtn" aria-label="New event" aria-haspopup="dialog" onClick={onNew}>
        <PlusIcon size={16} />
        New
      </button>
    </div>
  )
}
