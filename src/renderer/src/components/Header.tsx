import { MoonIcon, SunIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import { EventMenu } from './EventMenu'
import { OutputMenu } from './OutputMenu'

interface Props {
  events: EventMeta[]
  eventId: string | null
  onSelectEvent(eventId: string): void
  onCreateEvent(name: string): void
  theme: 'dark' | 'light'
  onToggleTheme(): void
}

export function Header(p: Props): React.JSX.Element {
  return (
    <header>
      <span className="brand">PPT Share</span>
      <EventMenu
        events={p.events}
        eventId={p.eventId}
        onSelect={p.onSelectEvent}
        onCreate={p.onCreateEvent}
      />
      <span className="grow" />
      <OutputMenu />
      <button className="btn icon" aria-label="Ganti tema" onClick={p.onToggleTheme}>
        {p.theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
      </button>
    </header>
  )
}
