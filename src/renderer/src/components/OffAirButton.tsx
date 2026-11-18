import { useEffect, useId, useRef, useState } from 'react'

interface Props {
  /** The event on air; named in the question so the operator knows which show ends. */
  eventName: string
  /** Takes the show off air (the reducer's offAir action). */
  onConfirm(): void
  testId: string
  /**
   * Header: the button stays and the question drops under it as a popover (the 52px bar has
   * no room for an inline question).
   */
  popover?: boolean
}

/**
 * Off air: a secondary button that asks before it ends the show. The question is an inline
 * region that replaces the button (no modal); in the header (`popover`) it drops under it. While it is open it owns the keyboard: Esc
 * cancels it, and no other key reaches Home or the console shortcuts.
 */
export function OffAirButton({ eventName, onConfirm, testId, popover }: Props): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  // Focus goes back to the button only when the question is dismissed, not when it is confirmed.
  const restore = useRef(false)
  const region = useRef<HTMLElement>(null)
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

  useEffect(() => {
    if (!asking) return
    // A click outside the question closes it without dispatching, so the console keys come back
    // at once. Focus is not moved back to the button in that case.
    const away = (e: PointerEvent): void => {
      if (region.current?.contains(e.target as Node)) return
      setAsking(false)
    }
    addEventListener('pointerdown', away, true)
    return () => removeEventListener('pointerdown', away, true)
  }, [asking])

  const trigger = (
    <button
      ref={button}
      type="button"
      className="btn alert"
      aria-expanded={popover ? asking : undefined}
      onClick={() => setAsking((a) => !a)}
      data-testid={testId}
    >
      Off air
    </button>
  )
  if (!asking) return popover ? <span className="offair-pop">{trigger}</span> : trigger

  const question = (
    <div
      ref={popover ? undefined : (region as React.RefObject<HTMLDivElement>)}
      className="offair-confirm"
      role="alertdialog"
      aria-labelledby={questionId}
      data-no-shortcuts
      data-testid={`${testId}-confirm`}
      // Focus moving out of the question (Tab past it, or a click on something unfocusable that
      // drops focus) closes it, as a click outside does; focus is left where the operator put it.
      onBlur={(e) => {
        const keep = popover ? region.current : e.currentTarget
        if (keep?.contains(e.relatedTarget as Node | null)) return
        setAsking(false)
      }}
    >
      <p id={questionId}>
        {`Take ${eventName || 'this event'} off air? The output goes to STANDBY.`}
      </p>
      <span className="actions">
        <button
          type="button"
          className="btn alert"
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
  if (!popover) return question
  // The wrapper is the region: a press on the button itself is not "outside".
  return (
    <span ref={region as React.RefObject<HTMLSpanElement>} className="offair-pop">
      {trigger}
      {question}
    </span>
  )
}
