import { GearSixIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
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
  /** Opens the Settings dialog (Task 4). No handler yet: the gear stays out of the way. */
  onOpenSettings?(): void
}

/** The brand slot. Task B2 swaps the text for the logo mark here and nowhere else. */
function Brand(): React.JSX.Element {
  return <span className="brand">Bridgecast</span>
}

/** Light / Dark, each with icon and label. There is no Auto here; Auto lives in Settings. */
export function ThemeSwitch({
  theme,
  onSet
}: {
  theme: Theme
  onSet(theme: Theme): void
}): React.JSX.Element {
  return (
    <div className="theme" role="group" aria-label="Theme">
      <button aria-pressed={theme === 'light'} onClick={() => onSet('light')}>
        <SunIcon size={16} />
        Light
      </button>
      <button aria-pressed={theme === 'dark'} onClick={() => onSet('dark')}>
        <MoonIcon size={16} />
        Dark
      </button>
    </div>
  )
}

export function Header(p: Props): React.JSX.Element {
  return (
    <header>
      <Brand />
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
      <ThemeSwitch theme={p.theme} onSet={p.onSetTheme} />
      <button
        className="gear"
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        onClick={p.onOpenSettings}
        disabled={!p.onOpenSettings}
      >
        <GearSixIcon size={18} />
      </button>
    </header>
  )
}
