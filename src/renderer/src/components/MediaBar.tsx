import { useEffect, useState } from 'react'
import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon, RepeatIcon } from '@phosphor-icons/react'
import type { Action } from '../../../shared/program'
import { formatTime, mediaEnded, mediaPosition, type MediaClock } from '../../../shared/media'

/** Position readout refresh; the clock itself is exact, this only redraws. */
const TICK_MS = 250

/** The media deck's player row above the transport bar: play/pause, restart, seek, loop. */
export function MediaBar({
  clock,
  onAction
}: {
  clock: MediaClock
  onAction(a: Action): void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  // Value shown while the thumb is dragged; null = follow the clock.
  const [drag, setDrag] = useState<number | null>(null)
  useEffect(() => {
    if (!clock.playing) return
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(t)
  }, [clock])
  const ended = mediaEnded(clock, now)
  const pos = drag ?? mediaPosition(clock, now)
  const showPause = clock.playing && !ended
  const commit = (): void => {
    if (drag === null) return
    onAction({ type: 'mediaSeek', at: drag })
    setDrag(null)
  }
  return (
    <div className="transport mediabar" role="group" aria-label="Video player" data-testid="media">
      <button
        className="tbtn icon"
        aria-label={showPause ? 'Pause video' : ended ? 'Play video again' : 'Play video'}
        onClick={() =>
          onAction({ type: ended ? 'mediaRestart' : showPause ? 'mediaPause' : 'mediaPlay' })
        }
      >
        {showPause ? <PauseIcon size={18} weight="fill" /> : <PlayIcon size={18} weight="fill" />}
      </button>
      <button
        className="tbtn icon"
        aria-label="Restart video"
        onClick={() => onAction({ type: 'mediaRestart' })}
      >
        <ArrowCounterClockwiseIcon size={18} />
      </button>
      <span className="tpos" data-testid="media-time">
        {formatTime(pos)} <small>/ {formatTime(clock.duration)}</small>
      </span>
      <input
        className="mseek"
        type="range"
        aria-label="Seek video"
        min={0}
        max={Math.max(clock.duration, 0.1)}
        step={0.1}
        value={Math.min(pos, clock.duration || pos)}
        disabled={!(clock.duration > 0)}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <button
        className="tbtn icon sound"
        aria-label="Loop video"
        aria-pressed={clock.loop}
        onClick={() => onAction({ type: 'mediaLoop', on: !clock.loop })}
      >
        <RepeatIcon size={18} />
      </button>
    </div>
  )
}
