import { useEffect, useRef, useState } from 'react'
import {
  CaretLeftIcon,
  CaretRightIcon,
  EyeSlashIcon,
  ImageIcon,
  SnowflakeIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon
} from '@phosphor-icons/react'
import { kvOnAir, type Action, type ProgramState } from '../../../shared/program'
import type { DeckMeta } from '../../../shared/types'
import { positionParts } from './transport'

/** How long the Black toast stays up. */
const TOAST_MS = 4000

/**
 * The one slim transport row under the monitor: Prev, position, Next, then the hold
 * buttons Freeze and KV, a gap, Black alone, and at the right end the sound button
 * (mutes the output; the same flag as Mute all in Controls > Output).
 */
export function TransportBar({
  state,
  deck,
  canPrev,
  canNext,
  canFreeze,
  muted,
  onToggleMute,
  onAction
}: {
  state: ProgramState
  deck: DeckMeta | null
  canPrev: boolean
  canNext: boolean
  /** Freezing needs a slide on the output; unfreezing is always possible. */
  canFreeze: boolean
  /** Output sound muted; null while the settings load (the button is disabled). */
  muted: boolean | null
  onToggleMute(): void
  onAction(a: Action): void
}): React.JSX.Element {
  const [toast, setToast] = useState(false)
  const was = useRef(state.black)
  // Black turned on (button or B): say so and offer Undo. Off again: the toast goes.
  useEffect(() => {
    if (state.black === was.current) return
    was.current = state.black
    setToast(state.black)
    if (!state.black) return
    const t = window.setTimeout(() => setToast(false), TOAST_MS)
    return () => window.clearTimeout(t)
  }, [state.black])
  const [cur, total] = deck ? positionParts(state.index, deck.slides.length) : ['', '']
  return (
    <div className="transport" data-testid="transport">
      <button
        className="tbtn icon"
        aria-label="Previous slide"
        title="Previous (←)"
        disabled={!canPrev}
        onClick={() => onAction({ type: 'prev' })}
      >
        <CaretLeftIcon size={18} weight="bold" aria-hidden="true" />
      </button>
      {deck?.source !== 'web' && (
        <span
          className="tpos"
          title="Operator position. While Freeze is on, it can differ from what is on air."
          data-testid="pos"
        >
          {deck ? (
            <>
              {cur}
              <small> / {total}</small>
            </>
          ) : (
            ''
          )}
        </span>
      )}
      <button
        className="tbtn icon next"
        aria-label="Next slide"
        title="Next (Space or →)"
        disabled={!canNext}
        onClick={() => onAction({ type: 'next' })}
      >
        <CaretRightIcon size={18} weight="bold" aria-hidden="true" />
      </button>
      <span className="sepv" aria-hidden="true" />
      <button
        className="tbtn hold"
        aria-pressed={state.frozen}
        disabled={!canFreeze}
        onClick={() => onAction({ type: 'toggleFreeze' })}
      >
        <SnowflakeIcon size={16} aria-hidden="true" />
        Freeze <kbd>F</kbd>
      </button>
      <button
        className="tbtn hold"
        aria-pressed={kvOnAir(state)}
        disabled={state.kvUrl === null}
        title={state.kvUrl === null ? 'No key visual yet. Add one in the Decks panel.' : undefined}
        onClick={() => onAction({ type: 'toggleKv' })}
      >
        <ImageIcon size={16} aria-hidden="true" />
        KV <kbd>K</kbd>
      </button>
      <span className="sepv" aria-hidden="true" />
      <button
        className="tbtn hold"
        aria-pressed={state.black}
        onClick={() => onAction({ type: 'toggleBlack' })}
      >
        <EyeSlashIcon size={16} aria-hidden="true" />
        Black <kbd>B</kbd>
      </button>
      <span className="spacer" />
      <button
        className="tbtn icon sound"
        aria-label="Mute output sound"
        aria-pressed={muted === true}
        disabled={muted === null}
        title={muted ? 'Output sound muted. Click to unmute.' : 'Mute output sound'}
        data-testid="transport-mute"
        onClick={onToggleMute}
      >
        {muted ? (
          <SpeakerSlashIcon size={18} aria-hidden="true" />
        ) : (
          <SpeakerHighIcon size={18} aria-hidden="true" />
        )}
      </button>
      {toast && state.black && (
        <div className="toast" role="status" data-testid="black-toast">
          <span>Black on air. The audience sees black.</span>
          <button
            onClick={() => {
              setToast(false)
              onAction({ type: 'toggleBlack' })
            }}
          >
            Undo <kbd>B</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
