import { useId } from 'react'
import { PauseCircleIcon } from '@phosphor-icons/react'
import { WEB_HOLD_TEXT } from '../model'

/**
 * The live web page lost its connection and the output holds its last good frame
 * (HOLD). Persistent until the operator acts. Resume web works only once the page
 * is ready again; until then the button stays focusable (aria-disabled) and says why.
 */
export function HoldWarning({
  canResume,
  onResume
}: {
  canResume: boolean
  onResume(): void
}): React.JSX.Element {
  const hintId = useId()
  return (
    <div className="action-error hold-warning" role="alert" data-testid="hold-warning">
      <PauseCircleIcon className="ph" size={20} />
      <div className="txt">
        <strong>{WEB_HOLD_TEXT}</strong>
        {!canResume && <span id={hintId}>Resume web is available when the page is ready.</span>}
      </div>
      <button
        className="btn sm"
        aria-disabled={!canResume}
        aria-describedby={canResume ? undefined : hintId}
        data-testid="resume-web"
        onClick={() => {
          if (canResume) onResume()
        }}
      >
        Resume web
      </button>
    </div>
  )
}
