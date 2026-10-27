import { useEffect, useRef, useState } from 'react'
import type { ProgramState } from '../../shared/program'
import { audioPlan, type OmtStatus } from '../../shared/omt'
import type { AudioSettings } from '../../shared/settings'
import { outputGain, outputSource } from './model'
import { OutputAudio } from './output-audio'
import { stageRect } from './stage'
import tapModuleUrl from './omt-tap.worklet.ts?worker&url'
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

/** The window's inner size, kept current on `resize` (the stage is laid out from it). */
function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Program output (route `#/output`), shown fullscreen by the HDMI window on
 * the second display. No chrome, no input: only black or the `shown` slide,
 * inside a stage with the canvas aspect (`stageRect`, centred; the rest of the
 * window is black) where each slide is drawn per its deck's fit. Slides change
 * through SlideLayers, so Next never flashes black between two slides.
 */
export function OutputView({ role = 'hdmi' }: { role?: 'hdmi' | 'omt' }): React.JSX.Element {
  // null until the real program state is known (initial fetch or a broadcast):
  // nothing is rendered before that, it is not "the current state".
  const [program, setProgram] = useState<ProgramState | null>(null)
  // Sound settings: also null until known, so a video never starts with the wrong sound.
  const [audio, setAudio] = useState<AudioSettings | null>(null)
  // Whether main shows this window (hdmi:status 'showing'). A hidden window is
  // not closed (its display is unplugged, or the operator window is on it), and
  // `backgroundThrottling: false` keeps `document.visibilityState` at 'visible',
  // so main's status is the signal. Until known it counts as not shown (silent).
  const [onScreen, setOnScreen] = useState(false)
  // getSettings failed: the slides still show (silently, `audio` stays null).
  const [audioFailed, setAudioFailed] = useState(false)
  const outputs = useAudioOutputs()
  // Audio setup never blocks slides: after this the output shows them anyway.
  const [setupTimedOut, setSetupTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSetupTimedOut(true), AUDIO_SETUP_MS)
    return () => clearTimeout(t)
  }, [])
  const readySent = useRef(false)
  // One gain stage for all the output's video sound (deck level times master).
  const [out] = useState(
    () =>
      new OutputAudio(undefined, {
        tapModuleUrl,
        onWarning: (w) => console.warn(`[audio] OMT sound is unavailable (${w})`)
      })
  )
  useEffect(() => () => out.close(), [out])
  // OMT network sender state and the MessagePort main feeds the OMT sound on.
  const [networkRunning, setNetworkRunning] = useState(false)
  const [audioPort, setAudioPort] = useState<MessagePort | null>(null)
  const windowSize = useWindowSize()

  useEffect(() => {
    const api = window.api
    let fresh = true
    let freshAudio = true
    let freshHdmi = true
    let freshOmt = true
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
        // No real settings arrived: the sound stays muted (see outputMuted).
        console.error('[output] settings failed to load, video stays muted:', e)
        setAudioFailed(true)
      })
    const offHdmi = api.onHdmiStatus((s) => {
      freshHdmi = false
      setOnScreen(s.state === 'showing')
    })
    api
      .getHdmiStatus()
      .then((s) => {
        if (freshHdmi) setOnScreen(s.state === 'showing')
      })
      .catch((e) => {
        // Main only shows this window once it is ready, so assume it is on screen.
        console.error('[output] HDMI status failed to load:', e)
        if (freshHdmi) setOnScreen(true)
      })
    const offOmt = api.onOmtStatus((s: OmtStatus) => {
      freshOmt = false
      setNetworkRunning(s.state === 'running')
    })
    api
      .getOmtStatus()
      .then((s) => {
        if (freshOmt) setNetworkRunning(s.state === 'running')
      })
      .catch((e) => console.error('[output] OMT status failed to load:', e))
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
      offHdmi()
      offOmt()
    }
  }, [])

  // OMT window: main answers a request with a fresh MessagePort, forwarded by
  // the preload as window.postMessage('omt:audio-port', '*', ports). A new port
  // replaces the old one, which is closed.
  const portRef = useRef<MessagePort | null>(null)
  useEffect(() => {
    if (role !== 'omt') return
    const onMessage = (e: MessageEvent): void => {
      if (e.data !== 'omt:audio-port' || !e.ports[0]) return
      const port = e.ports[0]
      if (portRef.current && portRef.current !== port) portRef.current.close()
      portRef.current = port
      setAudioPort(port)
    }
    window.addEventListener('message', onMessage)
    window.api.requestOmtAudioPort()
    return () => window.removeEventListener('message', onMessage)
  }, [role])

  // One window plays the sound here (HDMI while it shows, else OMT while a
  // network sender runs); the OMT window also taps it for the sender.
  const route = audio?.route ?? 'local'
  const plan = audioPlan(role, onScreen, networkRunning, route)
  useEffect(() => {
    out
      .setPlan({ local: plan.local, tap: plan.tap }, audioPort)
      .catch((e: unknown) => console.warn('[audio] sound plan failed:', e))
  }, [out, plan.local, plan.tap, audioPort])

  // A saved device is looked up in the device list, so wait (briefly) for the
  // list before the first video. A missing device, or a list that is late,
  // plays on the default one; a late list re-routes through SlideLayers.
  const sink = pickSink(audio?.deviceId ?? null, outputs ?? []).sinkId
  const gain = program ? outputGain(program, audio) : 1
  // data-gain shows the level OutputAudio holds after this call, so the e2e
  // reads what the audio path received, not what React computed.
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    out.setGain(gain)
    root.current?.setAttribute('data-gain', out.level.toFixed(2))
  }, [out, gain])
  useEffect(() => {
    out.setSink(sink).catch((e: unknown) => console.warn('[audio] audio device failed:', e))
  }, [out, sink])
  const soundReady = outputGateOpen(audio, outputs, setupTimedOut || audioFailed)

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

  const stage = program ? stageRect(program.canvas, windowSize) : null

  return (
    <div ref={root} className="output" aria-hidden="true">
      {program && stage && soundReady && (
        <div
          className="output-stage"
          data-canvas={`${program.canvas.width}x${program.canvas.height}`}
          style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }}
        >
          <SlideLayers
            media={outputSource(program)}
            fade={program.transition === 'fade'}
            muted={audio === null || audio.muted}
            audio={out}
            layerClass="output-layer"
            imgAttrs={(key) => ({ elementtiming: timingId(key) })}
            onShown={onShown}
          />
        </div>
      )}
    </div>
  )
}
