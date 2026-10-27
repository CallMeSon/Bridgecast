import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { DECK_NAME_MAX } from '../../../shared/types'
import { sanitizeWebUrl, webDomain } from '../../../shared/web'
import { errorMessage } from '../model'

interface Props {
  /** Edit mode: changes the page of this web deck (no name field). */
  edit?: { deckName: string; url: string }
  /** Adds or changes the page. Rejects with a user-facing message when main refuses. */
  onSubmit(url: string, name: string | undefined): Promise<void>
  /** Closes the dialog; `restoreFocus` is true when the keyboard closed it. */
  onClose(restoreFocus: boolean): void
}

const FOCUSABLE = 'input, button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

/**
 * "Add web page" (URL and an optional name), also "Edit URL" of a web deck. A modal
 * dialog: focus stays inside (Tab wraps), Escape or Cancel closes it, Enter submits.
 * `sanitizeWebUrl` shows its message under the field, and the http warning while
 * typing; main's refusal shows in the same place. Focus goes back to the opener
 * (the caller's job, on `onClose(true)`).
 */
export function AddWebDialog({ edit, onSubmit, onClose }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const urlInput = useRef<HTMLInputElement>(null)
  const id = useId()
  const [url, setUrl] = useState(edit?.url ?? '')
  const [name, setName] = useState('')
  // The refusal of the last submit (ours or main's); typing clears it.
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const checked = sanitizeWebUrl(url)
  const warning = 'warning' in checked ? checked.warning : undefined

  // The rest of the app is inert while the dialog is open (no Tab, no virtual cursor into
  // it); the cleanup also runs when the dialog unmounts abruptly.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    root.inert = true
    return () => {
      root.inert = false
    }
  }, [])

  useEffect(() => {
    urlInput.current?.focus()
    urlInput.current?.select()
  }, [])

  const submit = async (): Promise<void> => {
    if (busy) return
    const clean = sanitizeWebUrl(url)
    if ('error' in clean) {
      setError(clean.error)
      urlInput.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onSubmit(clean.url, name.trim() === '' ? undefined : name.trim())
      onClose(true)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
      urlInput.current?.focus()
    }
  }

  // A submit in flight cannot be cancelled: nothing closes the dialog until it answers.
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
    // Focus trap: Tab and Shift+Tab wrap inside the dialog.
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (!box.current?.contains(document.activeElement) || document.activeElement === box.current) {
      // Focus sits on the dialog itself (a click on its text): enter at the matching end.
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
  const hintId = `${id}-hint`
  return createPortal(
    <div
      className="modal-scrim"
      // On click, not pointerdown: the press itself would take focus away again after the restore.
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
        data-testid="add-web-dialog"
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
              {edit ? 'Edit URL' : 'Add web page'}
            </h2>
            <button type="button" className="btn sm" onClick={() => close(true)}>
              <XIcon size={14} />
              Close
            </button>
          </div>
          {edit && (
            <p className="hint deck-sound-name" title={edit.deckName}>
              {edit.deckName}
            </p>
          )}
          <div className="field">
            <label htmlFor={`${id}-url`}>Web address</label>
            <input
              ref={urlInput}
              id={`${id}-url`}
              className="text-input"
              type="text"
              inputMode="url"
              placeholder="https://www.canva.com/design/…"
              value={url}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : warning ? hintId : undefined}
              data-testid="add-web-url"
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
            />
            {error ? (
              <p id={errorId} className="pop-error" role="alert" data-testid="add-web-error">
                <WarningCircleIcon size={16} />
                {error}
              </p>
            ) : warning ? (
              <p id={hintId} className="pop-status warn" data-testid="add-web-warning">
                <WarningCircleIcon size={16} />
                {warning}
              </p>
            ) : (
              <p className="hint">
                {'url' in checked && url.trim() !== ''
                  ? `Opens ${webDomain(checked.url)}.`
                  : 'Paste the page address. https:// is added when missing.'}
              </p>
            )}
          </div>
          {!edit && (
            <div className="field">
              <label htmlFor={`${id}-name`}>Name (optional)</label>
              <input
                id={`${id}-name`}
                className="text-input"
                type="text"
                maxLength={DECK_NAME_MAX}
                placeholder="Defaults to the page title"
                value={name}
                autoComplete="off"
                data-testid="add-web-name"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => close(true)}>
              Cancel
            </button>
            <button type="submit" className="btn inverse" disabled={busy}>
              {edit ? 'Save' : 'Add web page'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
