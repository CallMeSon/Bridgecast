import { useEffect, useId, useRef, useState } from 'react'
import { ClockCountdownIcon, PauseCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { DeckEditErrorEvent } from '../../../shared/ipc'
import {
  APPLY_NOW_CONFIRM,
  NATIVE_HELPER_FAILED,
  NATIVE_NOT_READY,
  NATIVE_NOT_RESPONDING,
  NATIVE_PENDING,
  type NativeNotice
} from '../model'

const TEXT: Record<NativeNotice, string> = {
  notReady: NATIVE_NOT_READY,
  notResponding: NATIVE_NOT_RESPONDING,
  helper: NATIVE_HELPER_FAILED
}

/**
 * The live native deck shows still slides. Persistent until the operator acts or the slide show
 * returns. Resume PowerPoint works only once the deck's slide show is open again; until then
 * the button stays focusable (aria-disabled) and says why, like Resume web.
 */
export function NativeFallbackWarning({
  notice,
  canResume,
  onResume
}: {
  notice: NativeNotice
  canResume: boolean
  onResume(): void
}): React.JSX.Element {
  const hintId = useId()
  const resumable = notice === 'notResponding'
  return (
    <div className="action-error hold-warning" role="alert" data-testid="native-warning">
      <PauseCircleIcon className="ph" size={20} />
      <div className="txt">
        <strong>{TEXT[notice]}</strong>
        {resumable && !canResume && (
          <span id={hintId}>Resume PowerPoint is available when the slide show is ready.</span>
        )}
      </div>
      {resumable && (
        <button
          className="btn sm"
          aria-disabled={!canResume}
          aria-describedby={canResume ? undefined : hintId}
          data-testid="resume-native"
          onClick={() => {
            if (canResume) onResume()
          }}
        >
          Resume PowerPoint
        </button>
      )}
    </div>
  )
}

/**
 * A saved edit of the deck on air waits for it to leave air. Apply now asks first (inline,
 * no modal); Escape or Cancel keeps waiting.
 */
export function PendingBanner({
  deckName,
  onApplyNow
}: {
  deckName: string
  onApplyNow(): void
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const open = useRef<HTMLButtonElement>(null)
  const wasAsking = useRef(false)
  useEffect(() => {
    if (asking) cancel.current?.focus()
    else if (wasAsking.current) open.current?.focus()
    wasAsking.current = asking
  }, [asking])
  return (
    <div
      className="action-error"
      role="group"
      aria-label={`Changes to ${deckName} are waiting`}
      data-no-shortcuts
      data-testid="native-pending"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !asking) return
        e.stopPropagation()
        setAsking(false)
      }}
    >
      <ClockCountdownIcon className="ph" size={20} />
      <div className="txt">
        <strong role="status">{NATIVE_PENDING}</strong>
        <span>{asking ? APPLY_NOW_CONFIRM : deckName}</span>
      </div>
      {asking ? (
        <span className="actions">
          <button
            className="btn sm danger"
            data-testid="apply-now-yes"
            onClick={() => {
              setAsking(false)
              onApplyNow()
            }}
          >
            Apply now
          </button>
          <button ref={cancel} className="btn sm" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          ref={open}
          className="btn sm"
          data-testid="apply-now"
          onClick={() => setAsking(true)}
        >
          Apply now
        </button>
      )}
    </div>
  )
}

/** A background re-export failed; the previous version is still used. */
export function EditErrorBanner({
  error,
  onDismiss
}: {
  error: DeckEditErrorEvent
  onDismiss(): void
}): React.JSX.Element {
  return (
    <div className="action-error" role="alert" data-testid="edit-error">
      <WarningCircleIcon className="ph" size={20} />
      <div className="txt">
        <strong>{error.message}</strong>
      </div>
      <button className="btn sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
