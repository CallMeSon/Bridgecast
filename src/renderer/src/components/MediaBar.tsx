import { useEffect, useState } from 'react'
import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon, RepeatIcon } from '@phosphor-icons/react'
import * as Slider from '@radix-ui/react-slider'
import type { Action } from '../../../shared/program'
import { formatTime, mediaEnded, mediaPosition, type MediaClock } from '../../../shared/media'
import {
  SEEK_IDLE,
  keySeek,
  seekDrag,
  seekRelease,
  seekSettle,
  seekShown,
  timeAtFraction,
  type SeekView
} from '../../../shared/media-seek'

/** Position readout refresh; the clock itself is exact, this only redraws. */
const TICK_MS = 250
/** Longest a released seek value is held while waiting for main's clock. */
const PENDING_MS = 2000

/** The media deck's player row above the transport bar: play/pause, restart, seek, loop. */
export function MediaBar({
  clock,
  onAction
}: {
  clock: MediaClock
  onAction(a: Action): void
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [raw, setView] = useState<SeekView>(SEEK_IDLE)
  // The released value gives way once main's clock carries the new seek counter.
  const view = seekSettle(raw, clock.seek)
  // Time under the pointer while hovering the bar (null = not hovering), for the tooltip.
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    if (!clock.playing) return
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(t)
  }, [clock])
  // Safety: a seek main never acknowledged must not pin the thumb forever.
  useEffect(() => {
    if (!view.pending) return
    const t = window.setTimeout(() => setView((v) => ({ ...v, pending: null })), PENDING_MS)
    return () => window.clearTimeout(t)
  }, [view.pending])
  const ended = mediaEnded(clock, now)
  const pos = seekShown(view, mediaPosition(clock, now))
  const showPause = clock.playing && !ended
  const send = (at: number): void => {
    onAction({ type: 'mediaSeek', at })
    setView(seekRelease(at, clock.seek))
  }
  const dur = Math.max(clock.duration, 0.1)
  const tipAt = view.drag ?? hover
  const tip = tipAt === null ? null : Math.min(tipAt, dur)
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
      <Slider.Root
        className="mseek"
        data-testid="media-seek"
        min={0}
        max={dur}
        step={0.01}
        value={[Math.min(pos, dur)]}
        disabled={!(clock.duration > 0)}
        onValueChange={([v]) => setView((s) => seekDrag(s, v))}
        onValueCommit={([v]) => send(v)}
        onKeyDown={(e) => {
          // Arrows 1 s, PageUp/PageDown 10 s; Home/End are Radix's.
          const to = keySeek(e.key, pos, clock.duration)
          if (to === null) return
          e.preventDefault()
          send(to)
        }}
        onPointerMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          if (b.width > 0) setHover(timeAtFraction((e.clientX - b.left) / b.width, clock.duration))
        }}
        onPointerLeave={() => setHover(null)}
      >
        <Slider.Track className="mseek-track">
          <Slider.Range className="mseek-range" />
        </Slider.Track>
        <Slider.Thumb className="mseek-thumb" aria-label="Seek video" />
        {tip !== null && (
          <span
            className="mseek-tip mono"
            aria-hidden="true"
            style={{ left: `${(tip / dur) * 100}%` }}
          >
            {formatTime(tip)}
          </span>
        )}
      </Slider.Root>
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
