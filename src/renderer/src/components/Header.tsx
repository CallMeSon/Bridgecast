import { MoonIcon, SunIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import type { Theme } from '../theme'
import { EventMenu } from './EventMenu'
import { OutputMenu } from './OutputMenu'

interface Props {
  events: EventMeta[]
  eventId: string | null
  onSelectEvent(eventId: string): void
  onCreateEvent(name: string): void
  onEventUpdated(ev: EventMeta): void
  program: ProgramState
  theme: Theme
  onSetTheme(theme: Theme): void
}

/** Two segments, sun and moon; the pressed one is the active theme. */
function ThemeToggle({
  theme,
  onSet
}: {
  theme: Theme
  onSet(theme: Theme): void
}): React.JSX.Element {
  return (
    <div className="theme" role="group" aria-label="Theme">
      <button
        aria-label="Light theme"
        aria-pressed={theme === 'light'}
        onClick={() => onSet('light')}
      >
        <SunIcon size={16} />
      </button>
      <button aria-label="Dark theme" aria-pressed={theme === 'dark'} onClick={() => onSet('dark')}>
        <MoonIcon size={16} />
      </button>
    </div>
  )
}

export function Header(p: Props): React.JSX.Element {
  return (
    <header>
      <span className="brand">Bridgecast</span>
      <EventMenu
        events={p.events}
        eventId={p.eventId}
        onSelect={p.onSelectEvent}
        onCreate={p.onCreateEvent}
        program={p.program}
        onEventUpdated={p.onEventUpdated}
      />
      <span className="grow" />
      <OutputMenu program={p.program} />
      <ThemeToggle theme={p.theme} onSet={p.onSetTheme} />
    </header>
  )
}
