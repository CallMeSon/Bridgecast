import { useEffect, useRef, useState } from 'react'
import type { ProgramState } from '../../shared/program'
import { DEFAULT_AUDIO, type AudioSettings } from '../../shared/settings'
import { outputSource } from './model'
import { AUDIO_SETUP_MS, outputGateOpen, pickSink, useAudioOutputs } from './audio'
import { SlideLayers, type ShownMedia } from './components/SlideLayers'

const timingId = (key: number): string => `layer-${key}`

/**
 * Resolves once Chromium has painted the <img elementtiming={id}> (Element
 * Timing API). Painting a large image can lag the DOM commit by a few frames
 * even after decode(), so animation frames alone do not prove it is on screen.
 * Resolves anyway after `timeoutMs` in case no entry is reported.
 */
function imagePainted(id: string, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    let obs: PerformanceObserver | null = null
    const done = (): void => {
      obs?.disconnect()
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    try {
      obs = new PerformanceObserver((list) => {
        if (list.getEntries().some((e) => (e as { identifier?: string }).identifier === id)) done()
      })
      obs.observe({ type: 'element', buffered: true })
    } catch {
      // Element Timing unsupported: the timeout above resolves.
    }
  })
}

/**
 * Program output (route `#/output`), shown fullscreen by the HDMI window on
 * the second display. No chrome, no input: only black or the `shown` slide,
 * letterboxed with `object-fit: contain`. Slides change through SlideLayers,
 * so Next never flashes black between two slides.
 */
export function OutputView(): React.JSX.Element {
  // null until the real program state is known (initial fetch or a broadcast):
  // nothing is rendered before that, it is not "the current state".
  const [program, setProgram] = useState<ProgramState | null>(null)
  // Sound settings: also null until known, so a video never starts with the wrong sound.
  const [audio, setAudio] = useState<AudioSettings | null>(null)
  const outputs = useAudioOutputs()
  // Audio setup never blocks slides: after this the output shows them anyway.
  const [setupTimedOut, setSetupTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSetupTimedOut(true), AUDIO_SETUP_MS)
    return () => clearTimeout(t)
  }, [])
  const readySent = useRef(false)

  useEffect(() => {
    const api = window.api
    let fresh = true
    let freshAudio = true
    const offAudio = api.onAudioSettings((a) => {
      freshAudio = false
      setAudio(a)
    })
    api
      .getSettings()
      .then((s) => {
        if (freshAudio) setAudio(s.audio)
      })
      .catch((e) => {
        console.error('[output] settings failed to load:', e)
        if (freshAudio) setAudio(DEFAULT_AUDIO)
      })
    const off = api.onProgramState((s) => {
      fresh = false // a broadcast is newer than the initial fetch
      setProgram(s)
    })
    api
      .getSession()
      .then((session) => {
        if (fresh) setProgram(session.state)
      })
      .catch((e) => console.error('[output] initial state failed to load:', e))
    return () => {
      off()
      offAudio()
    }
  }, [])

  // A saved device is looked up in the device list, so wait (briefly) for the
  // list before the first video. A missing device, or a list that is late,
  // plays on the default one; a late list re-routes through SlideLayers.
  const sound = audio ?? DEFAULT_AUDIO
  const sink = pickSink(sound.deviceId, outputs ?? []).sinkId
  const soundReady = outputGateOpen(audio, outputs, setupTimedOut)

  // Tell main once the first layer for a known state is on screen, so the HDMI
  // window is shown without ever flashing a placeholder. An image is decoded
  // by then and Element Timing confirms it was painted; a video's first frame
  // has been presented (SlideLayers reports it only then). Then two animation
  // frames let that frame reach the screen.
  const onShown = (key: number, media: ShownMedia): void => {
    if (readySent.current) return
    readySent.current = true
    const painted = media?.kind === 'image' ? imagePainted(timingId(key)) : Promise.resolve()
    void painted.then(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => window.api.outputReady()))
    )
  }

  return (
    <div className="output" aria-hidden="true">
      {program && soundReady && (
        <SlideLayers
          media={outputSource(program)}
          fade={program.transition === 'fade'}
          muted={sound.muted}
          sinkId={sink}
          layerClass="output-layer"
          imgAttrs={(key) => ({ elementtiming: timingId(key) })}
          onShown={onShown}
        />
      )}
    </div>
  )
}
