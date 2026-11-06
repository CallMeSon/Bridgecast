import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { errorMessage } from '../model'
import { checkEventName, EVENT_NAME_MAX } from '../new-event'

interface Props {
  /** Names of the existing events, to refuse a duplicate. */
  existing: readonly string[]
  /** Creates and opens the event. Rejects with a user-facing message when main refuses. */
  onSubmit(name: string): Promise<void>
  /** Closes the dialog; `restoreFocus` is true when the keyboard closed it. */
  onClose(restoreFocus: boolean): void
}

const FOCUSABLE = 'input, button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

/**
 * "New event": a modal with one Name field. Focus stays inside (Tab wraps), Escape, the scrim
 * or Cancel closes it, Enter creates. The caller returns focus to the opener on `onClose(true)`.
 */
export function NewEventDialog({ existing, onSubmit, onClose }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The rest of the app is inert while the dialog is open.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    root.inert = true
    return () => {
      root.inert = false
    }
  }, [])

  useEffect(() => {
    input.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (busy) return
    const checked = checkEventName(name, existing)
    if (!checked.ok) {
      setError(checked.error)
      input.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onSubmit(checked.name)
      onClose(true)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
      input.current?.focus()
    }
  }

  const close = (restoreFocus: boolean): void => {
    if (!busy) onClose(restoreFocus)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (!box.current?.contains(document.activeElement) || document.activeElement === box.current) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const errorId = `${id}-error`
  return createPortal(
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(true)
      }}
    >
      <div
        ref={box}
        className="popover modal add-web"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={`${id}-title`}
        data-no-shortcuts
        data-testid="new-event-dialog"
        onKeyDown={onKeyDown}
      >
        <form
          className="pop-section"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="pop-head">
            <h2 className="pop-title" id={`${id}-title`}>
              New event
            </h2>
            <button type="button" className="btn sm" onClick={() => close(true)}>
              <XIcon size={14} />
              Close
            </button>
          </div>
          <div className="field">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              ref={input}
              id={`${id}-name`}
              className="text-input"
              type="text"
              maxLength={EVENT_NAME_MAX}
              placeholder="Annual gala"
              value={name}
              autoComplete="off"
              required
              aria-required="true"
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              data-testid="new-event-name"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
            {error && (
              <p id={errorId} className="pop-error" role="alert" data-testid="new-event-error">
                <WarningCircleIcon size={16} />
                {error}
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => close(true)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              Create event
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
