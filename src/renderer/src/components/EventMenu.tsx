import { useEffect, useRef, useState } from 'react'
import { CaretDownIcon, CheckIcon, PlusIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import { menuItems, onMenuKeyDown } from './menuNav'

interface Props {
  events: EventMeta[]
  eventId: string | null
  onSelect(eventId: string): void
  onCreate(name: string): void
}

export function EventMenu({ events, eventId, onSelect, onCreate }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // Set when the trigger is back on screen and should take focus again.
  const refocus = useRef(false)
  const current = events.find((e) => e.id === eventId)

  useEffect(() => {
    if (creating || !refocus.current) return
    refocus.current = false
    // Later than the key that closed the field: Enter's keypress must not land on
    // the trigger and open the menu.
    const t = setTimeout(() => trigger.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [creating])

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menuItems(menu.current!)[0]?.focus()
    const onClick = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') setOpen(false)
    }
    addEventListener('click', onClick)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('click', onClick)
      removeEventListener('keydown', onKey)
    }
  }, [open])

  const startNew = (): void => {
    setOpen(false)
    setDraft('')
    setCreating(true)
  }

  const endNew = (commit: boolean, restoreFocus: boolean): void => {
    const name = draft.trim()
    refocus.current = restoreFocus
    setCreating(false)
    if (commit && name) onCreate(name)
  }

  return (
    <div className="event" ref={wrap}>
      {creating ? (
        <div className="event-new">
          <span className="lbl">Acara</span>
          <input
            className="event-input"
            placeholder="Nama event baru"
            maxLength={60}
            aria-label="Nama event baru"
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
        </div>
      ) : (
        <button
          ref={trigger}
          className="event-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="lbl">Acara</span>
          {current ? (
            <strong>{current.name}</strong>
          ) : (
            <span className="placeholder">Pilih event</span>
          )}
          <CaretDownIcon className="ph" size={16} />
        </button>
      )}
      {open && (
        <div
          ref={menu}
          className="menu"
          role="menu"
          aria-label="Pilih acara"
          data-no-shortcuts
          onKeyDown={onMenuKeyDown}
        >
          {events.map((ev) => (
            <button
              key={ev.id}
              role="menuitem"
              onClick={() => {
                close()
                if (ev.id !== eventId) onSelect(ev.id)
              }}
            >
              <CheckIcon
                className="chk"
                size={16}
                style={{ visibility: ev.id === eventId ? 'visible' : 'hidden' }}
              />
              {ev.name}
            </button>
          ))}
          {events.length > 0 && <hr />}
          <button role="menuitem" onClick={startNew}>
            <PlusIcon className="chk muted" size={16} />
            Event baru
          </button>
        </div>
      )}
    </div>
  )
}
