import { PauseIcon } from '@phosphor-icons/react'
import type { DeckMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { outputSource, tally } from '../model'
import { EndCard } from './Slide'
import { StatusTag } from './StatusTag'
import { SlideLayers, type StreamOptions } from './SlideLayers'

/**
 * The Program column: tally in the head, the monitor, and the operator position.
 * The monitor shows exactly what is on the output (`outputSource`: the shown slide,
 * the KV, or black), not the operator position, in a frame with the canvas aspect.
 */
export function Program({
  state,
  deck,
  emptyHint = 'Drag .pptx, .ppt, or .pdf files into this window.',
  posterVersion = 0,
  stream,
  stepLabel = null
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
}): React.JSX.Element {
  const t = tally(state)
  const shown = state.shown
  const media = outputSource(state, posterVersion)
  return (
    <div className="program" data-state={t} data-testid="program">
      <div className="colhead">
        <h2>
          Program<span className="tag">PGM</span>
        </h2>
        <span className="tallies">
          {/* HOLD: the live web page lost its connection (own shape and word). */}
          {state.webHold && shown?.web && (t === 'live' || t === 'frozen') && (
            <span className="tally t-hold" data-testid="tally-hold">
              <PauseIcon size={14} weight="fill" />
              HOLD
            </span>
          )}
          <StatusTag kind={t === 'idle' ? 'standby' : t} variant="icon" data-testid="tally" />
        </span>
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
          <div className="pgm-meta">
            <span
              className="posg"
              title="Operator position. While Freeze is on, it can differ from what is on air."
            >
              {deck && <span className="pos-lbl">Position</span>}
              <span className="pos" data-testid="pos">
                {deck ? `${state.index + 1} / ${deck.slides.length}` : ''}
              </span>
            </span>
            {stepLabel && (
              <span className="stp" data-testid="step-label">
                {stepLabel}
              </span>
            )}
            <span className="ttl" title={deck?.name}>
              {deck?.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
