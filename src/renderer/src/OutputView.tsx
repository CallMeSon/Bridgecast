import { useEffect, useRef, useState } from 'react'
import { initialState, type ProgramState } from '../../shared/program'
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

/**
 * Program output (route `#/output`), rendered in the hidden offscreen window
 * and captured as frames. No chrome, no input: only black or the `shown` slide,
 * letterboxed with `object-fit: contain`.
 */
export function OutputView(): React.JSX.Element {
  const [program, setProgram] = useState<ProgramState>(initialState)
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, src: null, fade: false }])
  const seq = useRef(0)
  const topSrc = useRef<string | null>(null)
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

  const target = outputSource(program)
  const fade = program.transition === 'fade'

  useEffect(() => {
    if (target === topSrc.current) return
    topSrc.current = target
    const key = ++seq.current
    ;(async () => {
      // Decode first so neither a cut nor a fade ever shows a half-loaded image.
      if (target) await preload(target)
      if (key !== seq.current) return // superseded while loading
      clearTimeout(fadeTimer.current)
      if (!fade) {
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

  return (
    <div className="output" aria-hidden="true">
      {layers.map((l) => (
        <div key={l.key} className={l.fade ? 'output-layer fade' : 'output-layer'}>
          {l.src && <img src={l.src} alt="" draggable={false} />}
        </div>
      ))}
    </div>
  )
}
