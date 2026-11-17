import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import type { OrphanDeck } from '../../../shared/ipc'

/**
 * Decks whose folder survived while their id was missing from the event list (two copies of the
 * app used to overwrite `events.json`). They are on disk but invisible in the Decks panel until
 * they are put back, so the operator is told instead of finding a deck gone.
 */
export function OrphanDecksWarning({
  orphans,
  onRestore,
  onDismiss
}: {
  orphans: OrphanDeck[]
  onRestore(deck: OrphanDeck): void
  onDismiss(): void
}): React.JSX.Element | null {
  if (orphans.length === 0) return null
  return (
    <div className="action-error" role="alert" data-testid="orphan-decks">
      <WarningCircleIcon className="ph" size={20} />
      <div className="txt">
        <strong>
          {orphans.length === 1
            ? '1 deck was found on disk but is missing from its event.'
            : `${orphans.length} decks were found on disk but are missing from their events.`}
        </strong>
        <span>
          It was not deleted. Put it back at the end of its event to use it again.
          {orphans.some((o) => o.eventId === null) &&
            ' A deck whose event no longer exists cannot be put back automatically.'}
        </span>
        <div className="actions orphan-decks-actions">
          {orphans.map((o) => (
            <button
              key={o.deckId}
              type="button"
              className="btn sm"
              data-testid="orphan-decks-restore"
              disabled={o.eventId === null}
              title={
                o.eventId === null
                  ? 'Its event no longer exists, so there is nowhere to put it back.'
                  : 'Put this deck back at the end of its event'
              }
              onClick={() => onRestore(o)}
            >
              Put back “{o.name}”
            </button>
          ))}
        </div>
      </div>
      <button className="btn sm" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon size={14} />
        Dismiss
      </button>
    </div>
  )
}
