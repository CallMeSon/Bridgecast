import { EyeSlashIcon, SnowflakeIcon } from '@phosphor-icons/react'
import type { DeckMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { TALLY_TEXT, tally, type Tally } from '../model'
import { EndCard, SlideImage } from './Slide'

const TALLY_ICON: Partial<Record<Tally, React.JSX.Element>> = {
  frozen: <SnowflakeIcon size={14} />,
  black: <EyeSlashIcon size={14} />
}

/**
 * The Program column: tally in the head, the monitor, and the operator position.
 * The monitor always shows `shown` (what goes out), not the operator position.
 */
export function Program({
  state,
  deck
}: {
  state: ProgramState
  deck: DeckMeta | null
}): React.JSX.Element {
  const t = tally(state)
  const shown = state.shown
  return (
    <div className="program" data-state={t} data-testid="program">
      <div className="colhead">
        <h2>
          Program<span className="tag">PGM</span>
        </h2>
        <span className={`tally t-${t}`} data-testid="tally">
          {TALLY_ICON[t]}
          {TALLY_TEXT[t]}
        </span>
      </div>
      <div className="pgm-view">
        <div className="pgm-stack">
          <div className="screen" data-black={state.black}>
            {shown ? (
              <SlideImage
                key={`${shown.deckId}/${shown.file}`}
                src={slideUrl(shown.deckId, shown.file)}
                fade={state.transition === 'fade'}
                alt={`Slide ${shown.index + 1} di Program`}
              />
            ) : (
              <EndCard title="Belum ada slide" sub="Seret file .pptx, .ppt, .pdf ke jendela ini." />
            )}
            <div className="shade" />
          </div>
          <div className="pgm-meta">
            <span className="pos" data-testid="pos">
              {deck ? `${state.index + 1} / ${deck.slides.length}` : ''}
            </span>
            <span className="ttl" title={deck?.name}>
              {deck?.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
