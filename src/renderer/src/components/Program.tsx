import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CursorClickIcon, PauseIcon, WarningIcon } from '@phosphor-icons/react'
import type { DeckMeta } from '../../../shared/types'
import type { Action, ProgramState } from '../../../shared/program'
import type { PrepareInput } from '../../../shared/web'
import { errorMessage, INTERACTING_TEXT, outputSource, tally } from '../model'
import { claimKeys, useWebInteract, type WebInteractHandlers } from '../use-web-interact'
import { zoomTransform } from '../../../shared/zoom'
import { EndCard } from './Slide'
import { StatusTag } from './StatusTag'
import { SlideLayers, type StreamOptions } from './SlideLayers'
import { TransportBar } from './TransportBar'
import { audienceNote, standbyCard } from './program-copy'
import { useIdlePointer } from '../use-idle-pointer'

/**
 * The Program column: title row with the state tag, the monitor, one meta line and the
 * transport bar.
 * The monitor shows exactly what is on the output (`outputSource`: the shown slide,
 * the KV, or black), not the operator position, in a frame with the canvas aspect.
 */
export function Program({
  state,
  deck,
  emptyHint = 'Drag .pptx, .ppt, .pdf, or video files into this window.',
  posterVersion = 0,
  stream,
  stepLabel = null,
  nextLabel = null,
  canPrev,
  canNext,
  canFreeze,
  airEventName = null,
  muted,
  onToggleMute,
  onAction
}: {
  state: ProgramState
  deck: DeckMeta | null
  /** Second line of the empty monitor (e.g. a different hint while no event exists). */
  emptyHint?: string
  /** Version of the live web deck's snapshot (reloads the poster when it is rewritten). */
  posterVersion?: number
  /** How the monitor captures a live web page (video only, 30 fps; no sound). */
  stream?: StreamOptions
  /** 'Slide 4 · step 2/3' for a live native slide with steps. */
  stepLabel?: string | null
  /** 'Next: slide 4' while Next takes a slide; null otherwise. */
  nextLabel?: string | null
  canPrev: boolean
  canNext: boolean
  canFreeze: boolean
  /** Name of the event on air while it is not the current one; null otherwise. */
  airEventName?: string | null
  /** Output sound muted; null while the settings load. */
  muted: boolean | null
  onToggleMute(): void
  onAction(a: Action): void
}): React.JSX.Element {
  const t = tally(state)
  const shown = state.shown
  const media = outputSource(state, posterVersion)
  const liveWeb = shown?.web?.deckId ?? null
  const screen = useRef<HTMLDivElement>(null)
  const zoom = useRef<HTMLDivElement>(null)
  const capture = useRef<HTMLDivElement>(null)
  const monitor = useMonitorInteract(liveWeb, state.frozen, zoom, capture)
  // The pointer over the picture rests out of the way (moving shows it again).
  const pointer = useIdlePointer()
  return (
    <div className="program" data-state={t} data-testid="program">
      <div className="ptitle">
        {/* HOLD: the live web page lost its connection (own shape and word). */}
        {state.webHold && shown?.web && (t === 'live' || t === 'frozen') && (
          <span className="tally t-hold" data-testid="tally-hold">
            <PauseIcon size={14} weight="fill" />
            HOLD
          </span>
        )}
        <StatusTag kind={t === 'idle' ? 'standby' : t} variant="icon" data-testid="tally" />
        {liveWeb && (
          <button
            type="button"
            className="pgm-interact-btn"
            aria-pressed={monitor.on}
            title={
              monitor.on
                ? 'Interact is on: your clicks reach the audience. Esc stops.'
                : 'Turn on Interact to click, scroll and type in the live page.'
            }
            onClick={() => (monitor.on ? monitor.stop() : monitor.start())}
          >
            <CursorClickIcon size={16} weight={monitor.on ? 'fill' : 'bold'} aria-hidden="true" />
            Interact
          </button>
        )}
        <h2 className="where">
          <span className="nm" title={deck?.name}>
            {deck?.name ?? 'Program'}
          </span>
          {deck && <span className="sub"> / Program</span>}
          {deck && airEventName && (
            <span className="sub air" title={airEventName}>
              {' '}
              · {airEventName}
            </span>
          )}
        </h2>
      </div>
      <div className="pgm-view" onPointerMove={pointer.poke}>
        <div
          className="pgm-stack"
          style={
            {
              '--cw': state.canvas.width,
              '--ch': state.canvas.height
            } as React.CSSProperties
          }
        >
          <div
            ref={screen}
            className="screen"
            data-black={state.black}
            data-transition={state.transition}
            data-interact={String(monitor.on)}
            style={{ cursor: pointer.hidden ? 'none' : undefined }}
          >
            <div
              ref={zoom}
              className="zoom-layer"
              data-testid="monitor-zoom"
              data-zoom={state.zoom.scale.toFixed(2)}
              style={{ transform: shown !== null ? zoomTransform(state.zoom) : 'none' }}
            >
              {shown || media ? (
                <SlideLayers
                  media={media}
                  fade={state.transition === 'fade'}
                  muted
                  layerClass="slide pgm-layer"
                  stream={stream}
                  imgAttrs={(_key, url) => ({
                    alt:
                      url === state.kvUrl
                        ? 'KV on Program'
                        : `Slide ${(shown?.index ?? 0) + 1} on Program`
                  })}
                />
              ) : (
                <EndCard {...standbyCard(deck, state.index, emptyHint)} />
              )}
            </div>
            <div className="shade" />
            {/* Interact: the live page's input comes from here, mapped onto the picture. */}
            {monitor.on && (
              <div
                ref={capture}
                className="pgm-capture"
                tabIndex={0}
                role="application"
                aria-label={INTERACTING_TEXT}
                onMouseDown={monitor.input.onMouse}
                onMouseUp={monitor.input.onMouse}
                onMouseMove={monitor.input.onMouse}
                onMouseLeave={monitor.input.onMouseLeave}
                onWheel={monitor.input.onWheel}
                onKeyDown={monitor.onCaptureKey}
                onKeyUp={monitor.onCaptureKey}
                onContextMenu={(e) => e.preventDefault()}
              />
            )}
          </div>
        </div>
      </div>
      {monitor.on && (
        <p className="pgm-interacting" role="status">
          <CursorClickIcon size={16} weight="fill" aria-hidden="true" />
          {INTERACTING_TEXT}
        </p>
      )}
      {monitor.note && (
        <p className="pgm-interact-note" role="alert">
          <WarningIcon size={16} weight="bold" aria-hidden="true" />
          {monitor.note}
        </p>
      )}
      <div className="pgm-meta">
        <span className="mono">
          {state.canvas.width} × {state.canvas.height}
        </span>
        <span>Transition: {state.transition === 'fade' ? 'Fade' : 'Cut'}</span>
        {stepLabel && (
          <span className="stp" data-testid="step-label">
            {stepLabel}
          </span>
        )}
        {nextLabel && <span data-testid="next-label">{nextLabel}</span>}
        <span className="note">{audienceNote(state, t, deck?.source === 'web')}</span>
      </div>
      <TransportBar
        state={state}
        deck={deck}
        canPrev={canPrev}
        canNext={canNext}
        canFreeze={canFreeze}
        muted={muted}
        onToggleMute={onToggleMute}
        onAction={onAction}
      />
    </div>
  )
}

/**
 * Interact on the operator monitor: while it is on, the live web page takes the pointer,
 * wheel and keys from the picture, and the app shortcuts stand aside. Turning it on asks
 * main (the page must be on air). It goes off by itself when the live page changes or
 * leaves air, on Esc, and when main refuses an input; main drops its own switch in the
 * same cases.
 */
interface MonitorInteract {
  on: boolean
  note: string | null
  start: () => void
  stop: () => void
  input: WebInteractHandlers
  onCaptureKey: (e: React.KeyboardEvent) => void
}

function useMonitorInteract(
  liveWeb: string | null,
  frozen: boolean,
  screen: RefObject<HTMLDivElement | null>,
  capture: RefObject<HTMLDivElement | null>
): MonitorInteract {
  const [on, setOn] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [onFor, setOnFor] = useState(liveWeb)
  // The live page changed or left air: Interact goes with it, during this render.
  if (onFor !== liveWeb) {
    setOnFor(liveWeb)
    if (on) setOn(false)
  }
  // Main refuses input once the page is not on air any more: Interact goes off and says so.
  const send = useCallback(
    (input: PrepareInput): void => {
      if (!liveWeb) return
      window.api.webInput(liveWeb, input).then(
        (ok) => {
          if (ok) return
          setOn(false)
          setNote('Interact stopped: the page is no longer on air.')
        },
        (e: unknown) => setNote(errorMessage(e))
      )
    },
    [liveWeb]
  )
  const input = useWebInteract({ active: on, page: screen, send })
  const { release } = input
  const stop = useCallback((): void => {
    release()
    setOn(false)
    setNote(null)
    if (liveWeb) {
      window.api.setWebInteract(liveWeb, false).catch((e: unknown) => setNote(errorMessage(e)))
    }
  }, [liveWeb, release])
  const start = (): void => {
    if (!liveWeb) return
    window.api.setWebInteract(liveWeb, true).then(
      () => {
        setOn(true)
        setNote(null)
      },
      (e: unknown) => setNote(errorMessage(e))
    )
  }
  // While on: the keys go to the picture (Space must not press the Interact button, and the
  // shortcuts stand aside), and Esc stops it from anywhere in the window.
  useEffect(() => {
    if (!on) return
    const releaseKeys = claimKeys()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      stop()
    }
    window.addEventListener('keydown', onKey)
    capture.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      releaseKeys()
    }
  }, [on, stop, capture])
  // Unfreezing turns Interact off, as in Prepare: a click that reaches the audience after
  // Unfreeze is a new, deliberate press.
  const frozenBefore = useRef(frozen)
  useEffect(() => {
    const was = frozenBefore.current
    frozenBefore.current = frozen
    if (was && !frozen && on) stop()
  }, [frozen, on, stop])
  // Esc stops Interact (the window listener above); it does not reach the page.
  const onCaptureKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') return
    input.onKey(e)
  }
  return { on, note, start, stop, input, onCaptureKey }
}
