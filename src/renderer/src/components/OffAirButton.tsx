import { useEffect, useId, useRef, useState } from 'react'

interface Props {
  /** The event on air; named in the question so the operator knows which show ends. */
  eventName: string
  /** Takes the show off air (the reducer's offAir action). */
  onConfirm(): void
  testId: string
}

/**
 * Off air: a secondary button that asks before it ends the show. The question is an inline
 * region that replaces the button (no modal). While it is open it owns the keyboard: Esc
 * cancels it, and no other key reaches Home or the console shortcuts.
 */
export function OffAirButton({ eventName, onConfirm, testId }: Props): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  // Focus goes back to the button only when the question is dismissed, not when it is confirmed.
  const restore = useRef(false)
  const questionId = useId()

  useEffect(() => {
    if (asking) {
      cancel.current?.focus()
      return
    }
    if (restore.current) {
      restore.current = false
      button.current?.focus()
    }
  }, [asking])

  useEffect(() => {
    if (!asking) return
    // Capture on window: this runs before Home's and the console's bubbling key listeners.
    const owns = (e: KeyboardEvent): void => {
      e.stopPropagation()
      if (e.key !== 'Escape') return
      e.preventDefault()
      restore.current = true
      setAsking(false)
    }
    addEventListener('keydown', owns, true)
    return () => removeEventListener('keydown', owns, true)
  }, [asking])

  if (!asking) {
    return (
      <button
        ref={button}
        type="button"
        className="btn"
        onClick={() => setAsking(true)}
        data-testid={testId}
      >
        Off air
      </button>
    )
  }

  return (
    <div
      className="offair-confirm"
      role="alertdialog"
      aria-labelledby={questionId}
      data-no-shortcuts
      data-testid={`${testId}-confirm`}
    >
      <p id={questionId}>
        {`Take ${eventName || 'this event'} off air? The output goes to STANDBY.`}
      </p>
      <span className="actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setAsking(false)
            onConfirm()
          }}
          data-testid={`${testId}-yes`}
        >
          Off air
        </button>
        <button
          ref={cancel}
          type="button"
          className="btn"
          onClick={() => {
            restore.current = true
            setAsking(false)
          }}
        >
          Cancel
        </button>
      </span>
    </div>
  )
}
