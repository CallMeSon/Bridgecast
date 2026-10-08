import { useEffect, useRef, useState } from 'react'
import type { ProgramState } from '../../shared/program'
import { outputSource } from './model'

/** Crossfade length for transition 'fade' (spec: 250 ms); also in output.css. */
const FADE_MS = 250

interface Layer {
  key: number
  /** null = black. */
  src: string | null
  fade: boolean
}

async function preload(src: string): Promise<void> {
  const img = new Image()
  img.src = src
  // A broken image still has to replace the old slide; it then shows as black.
  await img.decode().catch(() => undefined)
}

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
 * letterboxed with `object-fit: contain`.
 */
export function OutputView(): React.JSX.Element {
  // null until the real program state is known (initial fetch or a broadcast):
  // the black placeholder before that is not "the current state".
  const [program, setProgram] = useState<ProgramState | null>(null)
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, src: null, fade: false }])
  const seq = useRef(0)
  /** undefined = nothing committed for a known state yet. */
  const topSrc = useRef<string | null | undefined>(undefined)
  /** Key of the first layer for a known state; `output:ready` once it is on screen. */
  const readyKey = useRef<number | null>(null)
  const readySent = useRef(false)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const api = window.api
    let fresh = true
    const off = api.onProgramState((s) => {
      fresh = false // a broadcast is newer than the initial fetch
      setProgram(s)
    })
    api
      .getSession()
      .then((session) => {
        if (fresh) setProgram(session.state)
      })
      .catch((e) => console.error('[output] status awal gagal dimuat:', e))
    return () => {
      off()
      clearTimeout(fadeTimer.current)
    }
  }, [])

  const target = program ? outputSource(program) : undefined
  const fade = program?.transition === 'fade'

  useEffect(() => {
    if (target === undefined || target === topSrc.current) return
    // The very first layer is a cut: a fresh window (new resolution, or a
    // restart) must show the current state at once, not fade it in from black.
    const first = topSrc.current === undefined
    topSrc.current = target
    const key = ++seq.current
    ;(async () => {
      // Decode first so neither a cut nor a fade ever shows a half-loaded image.
      if (target) await preload(target)
      if (key !== seq.current) return // superseded while loading
      clearTimeout(fadeTimer.current)
      if (!fade || first || !readySent.current) {
        if (!readySent.current) readyKey.current = key
        setLayers([{ key, src: target, fade: false }])
        return
      }
      // The new layer fades in over the old one (snapped to fully opaque if it
      // was itself still fading); afterwards the old layer is dropped.
      setLayers((ls) => {
        const top = ls[ls.length - 1]
        return [
          { ...top, fade: false },
          { key, src: target, fade: true }
        ]
      })
      fadeTimer.current = setTimeout(() => {
        setLayers((ls) => (ls[ls.length - 1]?.key === key ? ls.slice(-1) : ls))
      }, FADE_MS + 50)
    })()
  }, [target, fade])

  // Tell main once the first real layer is committed and painted, so
  // the HDMI window is shown without ever flashing the black placeholder. The <img> in the DOM is decoded itself (the
  // preload decoded another Image object; Chromium may otherwise paint a large
  // image a frame late), then two animation frames let that frame be drawn.
  useEffect(() => {
    const top = layers[layers.length - 1]
    if (readySent.current || readyKey.current === null || top?.key !== readyKey.current) return
    readySent.current = true
    const shown = top.src ? imagePainted(timingId(top.key)) : Promise.resolve()
    void shown.then(() =>
      requestAnimationFrame(() => requestAnimationFrame(() => window.api.outputReady()))
    )
  }, [layers])

  return (
    <div className="output" aria-hidden="true">
      {layers.map((l) => (
        <div
          key={l.key}
          data-layer={l.key}
          className={l.fade ? 'output-layer fade' : 'output-layer'}
        >
          {l.src && (
            <img src={l.src} alt="" draggable={false} {...{ elementtiming: timingId(l.key) }} />
          )}
        </div>
      ))}
    </div>
  )
}
