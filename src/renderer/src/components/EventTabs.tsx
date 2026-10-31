import { useEffect, useRef, useState } from 'react'
import { PlusIcon, SquaresFourIcon, XIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import type { Tally } from '../model'
import { StatusTag } from './StatusTag'

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
  onNew(name: string): void
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
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const newBtn = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)

  const tabs = ids.flatMap((id) => events.find((e) => e.id === id) ?? [])
  const selected = view === 'console' ? current : null
  // Roving tabindex: the selected tab, else the first one, is the stop for Tab.
  const stop = tabs.some((t) => t.id === selected) ? selected : (tabs[0]?.id ?? null)

  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected=true]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selected, ids.length])

  useEffect(() => {
    if (creating || !refocus.current) return
    refocus.current = false
    // Later than the key that closed the field: Enter's keypress must not land on New.
    const t = setTimeout(() => newBtn.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [creating])

  const endNew = (commit: boolean, restoreFocus: boolean): void => {
    const name = draft.trim()
    refocus.current = restoreFocus
    setCreating(false)
    if (commit && name) onNew(name)
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
      if (id) onClose(id)
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
                title={live ? `${ev.name}, on air` : ev.name}
                tabIndex={isStop ? 0 : -1}
                onClick={() => onSelect(ev.id)}
              >
                <span className="tn">{ev.name}</span>
                {live && (
                  <StatusTag kind={airState as Exclude<Tally, 'idle'>} variant="icon" size="sm" />
                )}
              </button>
              <button
                className="x"
                aria-label={`Close ${ev.name}`}
                title="Close tab"
                tabIndex={isStop ? 0 : -1}
                onClick={() => onClose(ev.id)}
              >
                <XIcon size={12} />
              </button>
            </div>
          )
        })}
      </div>
      {creating ? (
        <input
          className="event-input"
          placeholder="New event name"
          maxLength={60}
          aria-label="New event name"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') endNew(true, true)
            else if (e.key === 'Escape') endNew(false, true)
          }}
          // Leaving the field without Enter cancels: a stray click never creates an event.
          onBlur={() => endNew(false, false)}
        />
      ) : (
        <button
          ref={newBtn}
          className="newbtn"
          aria-label="New event"
          onClick={() => {
            setDraft('')
            setCreating(true)
          }}
        >
          <PlusIcon size={16} />
          New
        </button>
      )}
    </div>
  )
}
