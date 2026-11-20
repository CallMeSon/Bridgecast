import { useEffect, useRef, useState } from 'react'
import { zoomApplies, type ProgramState } from '../../shared/program'
import { audioPlan, networkRunning, type NdiStatus, type OmtStatus } from '../../shared/omt'
import type { AudioSettings } from '../../shared/settings'
import { outputGain, outputSource } from './model'
import { OutputAudio } from './output-audio'
import { useLibreOfficeSound } from './lo-sound'
import { stageRect } from './stage'
import tapModuleUrl from './omt-tap.worklet.ts?worker&url'
import pcmModuleUrl from './pcm-source.worklet.ts?worker&url'
import { AUDIO_SETUP_MS, outputGateOpen, pickSink, useAudioOutputs } from './audio'
import { SlideLayers, type ShownMedia, type StreamOptions } from './components/SlideLayers'
import { WebPrecapture } from './components/WebPrecapture'
import { useWebOutputs, useWebPages } from './web-pages'
import { useDeckVersions } from './slideshow'
import { zoomTransform } from '../../shared/zoom'
import { useInstantZoom } from './use-instant-zoom'
import { capturesForGate, precaptureIds, streamFps } from './stream'

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
  // Network frame rate setting: a captured web page is sent at it while OMT or NDI runs.
  const [netFps, setNetFps] = useState<number | undefined>(undefined)
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
        pcmModuleUrl,
        onWarning: (w) => window.api.reportOmtWarning(w)
      })
  )
  useEffect(() => () => out.close(), [out])
  // Network (OMT, NDI) sender state and the MessagePort main feeds the OMT sound on.
  const [omtState, setOmtState] = useState<OmtStatus | null>(null)
  const [ndiState, setNdiState] = useState<NdiStatus | null>(null)
  const [audioPort, setAudioPort] = useState<MessagePort | null>(null)
  const windowSize = useWindowSize()

  useEffect(() => {
    const api = window.api
    let fresh = true
    let freshAudio = true
    let freshHdmi = true
    let freshOmt = true
    let freshNdi = true
    const offAudio = api.onAudioSettings((a) => {
      freshAudio = false
      setAudio(a)
    })
    api
      .getSettings()
      .then((s) => {
        setNetFps(s.omt.fps)
        if (freshAudio) setAudio(s.audio)
      })
      .catch((e) => {
        // No real settings arrived: the sound stays muted.
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
      setOmtState(s)
    })
    api
      .getOmtStatus()
      .then((s) => {
        if (freshOmt) setOmtState(s)
      })
      .catch((e) => console.error('[output] OMT status failed to load:', e))
    const offNdi = api.onNdiStatus((s: NdiStatus) => {
      freshNdi = false
      setNdiState(s)
    })
    api
      .getNdiStatus()
      .then((s) => {
        if (freshNdi) setNdiState(s)
      })
      .catch((e) => console.error('[output] NDI status failed to load:', e))
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
      offNdi()
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
    return () => {
      window.removeEventListener('message', onMessage)
      portRef.current?.close()
      portRef.current = null
    }
  }, [role])

  // PowerPoint's sound (a native deck): main sends it over a MessagePort to both output
  // windows, which play it through the same gain as a video. A new port replaces the old.
  useEffect(() => {
    let current: MessagePort | null = null
    const onMessage = (e: MessageEvent): void => {
      if (e.data !== 'slideshow:audio-port' || !e.ports[0]) return
      const port = e.ports[0]
      if (current && current !== port) current.close()
      current = port
      out
        .setPcmPort(port)
        .then((ok) => {
          // No sound path here: close the port so main's blocks are not queued unread.
          if (!ok && current === port) port.close()
        })
        .catch((err: unknown) => console.warn('[audio] PowerPoint sound failed:', err))
    }
    window.addEventListener('message', onMessage)
    window.api.requestSlideshowAudioPort()
    return () => {
      window.removeEventListener('message', onMessage)
      current?.close()
      current = null
      void out.setPcmPort(null)
    }
  }, [out])

  // One window plays the sound here (HDMI while it shows, else OMT while a
  // network sender runs); the OMT window also taps it for the sender.
  const route = audio?.route ?? 'local'
  const plan = audioPlan(role, onScreen, networkRunning(omtState, ndiState), route)
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

  // LibreOffice (Linux): its sound arrives from a private sink, captured while a native deck is
  // on air and not covered by Black or the KV image.
  const [engine, setEngine] = useState<string>('powerpoint')
  useEffect(() => {
    window.api
      .slideshowStatus()
      .then((s) => setEngine(s.engine))
      .catch(() => undefined)
  }, [])
  useLibreOfficeSound(
    out,
    engine === 'libreoffice' &&
      !!program &&
      program.shown?.playback === 'native' &&
      !program.black &&
      !program.kv
  )

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

  // Web deck pages: this window captures the live one (stream layer) and, while
  // main counts it as an active output, the pages not on air yet (ready gate).
  const pages = useWebPages()
  const webOutputs = useWebOutputs()
  const deckVersions = useDeckVersions()
  const shownId = program?.shown?.deckId ?? ''
  const media = program
    ? outputSource(program, (pages.versions[shownId] ?? 0) + (deckVersions[shownId] ?? 0))
    : null
  const streaming = media?.kind === 'stream' ? media.deckId : null
  const precapture = capturesForGate(role, webOutputs)
    ? precaptureIds(pages.statuses, streaming)
    : []
  const streamOpts: StreamOptions | undefined = program
    ? {
        canvas: program.canvas,
        fps: streamFps(netFps, networkRunning(omtState, ndiState)),
        generation: (id) => pages.generations[id] ?? 0,
        onFrame: (id, source) =>
          void (source === 'desktop' ? undefined : window.api.webFrame(id).catch(() => undefined)),
        // A slide show capture that ends shows the slide's PNG; only a web page goes on HOLD.
        onEnded: (id, source) => {
          if (source === 'tab') void window.api.webEnded(id).catch(() => undefined)
        },
        // HOLD before a Reload, Back, Forward or new URL waits for this pause.
        onPaused: (id, source) => {
          if (source === 'tab') void window.api.webHeld(id).catch(() => undefined)
        },
        onFailed: (id, failed) =>
          void window.api.webCaptureFailed(id, failed).catch(() => undefined)
      }
    : undefined

  const stage = program ? stageRect(program.canvas, windowSize) : null
  // Only the HDMI picture zooms (OMT/NDI stay whole); a take or KV resets it without motion.
  const zoomOn = role === 'hdmi' && program !== null && zoomApplies(program)
  const zoomCut = useInstantZoom(program?.take ?? 0, zoomOn)

  return (
    <div
      ref={root}
      className="output"
      aria-hidden="true"
      data-local={String(plan.local)}
      data-tap={String(plan.tap)}
    >
      {program && stage && soundReady && (
        <div
          className="output-stage"
          data-canvas={`${program.canvas.width}x${program.canvas.height}`}
          style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }}
        >
          <div
            className="zoom-layer"
            data-testid="output-zoom"
            data-zoom={program.zoom.scale.toFixed(2)}
            data-instant={zoomCut}
            style={{ transform: zoomOn ? zoomTransform(program.zoom) : 'none' }}
          >
            <SlideLayers
              media={media}
              fade={program.transition === 'fade'}
              muted={audio === null || audio.muted}
              audio={out}
              layerClass="output-layer"
              imgAttrs={(key) => ({ elementtiming: timingId(key) })}
              onShown={onShown}
              stream={streamOpts}
            />
          </div>
        </div>
      )}
      <WebPrecapture deckIds={precapture} canvas={program?.canvas} onGone={pages.refresh} />
    </div>
  )
}
