import { PauseIcon } from '@phosphor-icons/react'
import type { DeckMeta } from '../../../shared/types'
import type { Action, ProgramState } from '../../../shared/program'
import { outputSource, tally } from '../model'
import { EndCard } from './Slide'
import { StatusTag } from './StatusTag'
import { SlideLayers, type StreamOptions } from './SlideLayers'
import { TransportBar } from './TransportBar'

/**
 * The Program column: title row with the state tag, the monitor, one meta line and the
 * transport bar.
 * The monitor shows exactly what is on the output (`outputSource`: the shown slide,
 * the KV, or black), not the operator position, in a frame with the canvas aspect.
 */
export function Program({
  state,
  deck,
  emptyHint = 'Drag .pptx, .ppt, or .pdf files into this window.',
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
      <div className="pgm-view">
        <div
          className="pgm-stack"
          style={
            {
              '--cw': state.canvas.width,
              '--ch': state.canvas.height
            } as React.CSSProperties
          }
        >
          <div className="screen" data-black={state.black} data-transition={state.transition}>
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
              <EndCard title="No slides yet" sub={emptyHint} />
            )}
            <div className="shade" />
          </div>
        </div>
      </div>
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
        <span className="note">{audienceNote(state, t)}</span>
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

/** One sentence: what the audience sees right now. */
function audienceNote(state: ProgramState, t: ReturnType<typeof tally>): string {
  const n = (state.shown?.index ?? 0) + 1
  switch (t) {
    case 'live':
      return `Audience sees slide ${n}`
    case 'frozen':
      return `Audience sees slide ${n}, held`
    case 'black':
      return 'Audience sees black'
    case 'kv':
      return 'Audience sees the key visual'
    default:
      return 'Audience sees the standby card'
  }
}
