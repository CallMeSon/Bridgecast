import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'

/**
 * A failed Program action (Next, Freeze, ...) next to the tally. Persistent until
 * dismissed or the next action succeeds. Shown by text and icon, never by red:
 * red is reserved for on-air tallies.
 */
export function ActionError({
  message,
  onDismiss
}: {
  message: string | null
  onDismiss(): void
}): React.JSX.Element | null {
  if (message === null) return null
  return (
    <div className="action-error" role="alert" data-testid="action-error">
      <WarningCircleIcon className="ph" size={20} />
      <div className="txt">
        <strong>Aksi gagal, Program tidak berubah.</strong>
        <span>{message}</span>
      </div>
      <button className="btn sm" aria-label="Tutup pemberitahuan" onClick={onDismiss}>
        <XIcon size={14} />
        Tutup
      </button>
    </div>
  )
}

/** Short, non-blocking confirmation ("KV disimpan"); the region exists before its text changes. */
export function SaveNote({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="save-note" role="status" aria-live="polite" data-testid="save-note">
      {text}
    </div>
  )
}
