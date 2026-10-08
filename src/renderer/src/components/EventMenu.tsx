import { useEffect, useRef, useState } from 'react'
import { CaretDownIcon, CheckIcon, PlusIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'

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
  const current = events.find((e) => e.id === eventId)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
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

  const endNew = (commit: boolean): void => {
    const name = draft.trim()
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
              if (e.key === 'Enter') endNew(true)
              else if (e.key === 'Escape') endNew(false)
            }}
            onBlur={() => endNew(true)}
          />
        </div>
      ) : (
        <button
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
        <div className="menu" role="menu">
          {events.map((ev) => (
            <button
              key={ev.id}
              role="menuitem"
              onClick={() => {
                setOpen(false)
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
