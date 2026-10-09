import { useEffect, useRef, useState } from 'react'
import type { ProgramState } from '../../shared/program'
import { outputSource } from './model'
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
  const readySent = useRef(false)

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
      .catch((e) => console.error('[output] initial state failed to load:', e))
    return off
  }, [])

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
      {program && (
        <SlideLayers
          media={outputSource(program)}
          fade={program.transition === 'fade'}
          muted={false}
          layerClass="output-layer"
          imgAttrs={(key) => ({ elementtiming: timingId(key) })}
          onShown={onShown}
        />
      )}
    </div>
  )
}
