import { useEffect, useRef } from 'react'
import { meterFill, meterStep } from '../../../shared/audio-meter'
import type { MonitorSound } from '../use-monitor-sound'

/** Meter refresh: about 25 Hz, enough to look live without costing a render per frame. */
const TICK_MS = 40
/** Fill above this counts as sound flowing. */
const ACTIVE = 0.02

/**
 * The Program sound level: a thin bar that moves with the real signal after the deck, master and
 * mute gain, rests empty when silent and shows "Muted" (hatched track plus the word, not colour
 * alone) while the output is muted. It writes to the DOM directly, so the app does not render 25
 * times a second.
 */
export function AudioMeter({
  sound,
  muted
}: {
  sound: MonitorSound
  muted: boolean
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const fillEl = useRef<HTMLSpanElement>(null)
  const { out } = sound
  useEffect(() => {
    let fill = 0
    const t = setInterval(() => {
      fill = meterStep(fill, muted ? 0 : meterFill(out.signal()))
      if (fillEl.current) fillEl.current.style.transform = `scaleX(${fill.toFixed(3)})`
      const el = root.current
      if (!el) return
      const state = muted ? 'muted' : fill > ACTIVE ? 'live' : 'silent'
      if (el.dataset.state !== state) {
        el.dataset.state = state
        el.setAttribute('aria-valuetext', STATE_TEXT[state])
      }
      el.setAttribute('aria-valuenow', String(Math.round(fill * 100)))
    }, TICK_MS)
    return () => clearInterval(t)
  }, [out, muted])
  return (
    <div
      ref={root}
      className="ameter"
      role="meter"
      aria-label="Program sound level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      aria-valuetext={STATE_TEXT[muted ? 'muted' : 'silent']}
      data-state={muted ? 'muted' : 'silent'}
      data-sound={sound.auto ? 'auto' : sound.local ? 'monitor' : 'off'}
      data-local={String(sound.local)}
      data-testid="audio-meter"
      title={
        sound.auto
          ? 'No output window plays the sound, so this window does.'
          : sound.local
            ? 'Monitor is on: this window plays the sound too.'
            : 'Level of the Program sound.'
      }
    >
      <span className="ameter-track">
        <span ref={fillEl} className="ameter-fill" />
      </span>
      {muted && <span className="ameter-note">Muted</span>}
    </div>
  )
}

const STATE_TEXT = { muted: 'Muted', silent: 'No sound', live: 'Sound playing' } as const
