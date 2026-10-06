import type { ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { TALLY_TEXT, tally } from '../model'
import { EndCard, SlideImage } from './Slide'

/** The Program monitor: always shows `shown` (what goes out), not the operator position. */
export function Program({ state }: { state: ProgramState }): React.JSX.Element {
  const t = tally(state)
  const shown = state.shown
  return (
    <div className="program" data-state={t} data-testid="program">
      <div className="screen" data-black={state.black}>
        {shown ? (
          <SlideImage
            key={`${shown.deckId}/${shown.file}`}
            src={slideUrl(shown.deckId, shown.file)}
            fade={state.transition === 'fade'}
            alt={`Slide ${shown.index + 1} di Program`}
          />
        ) : (
          <EndCard title="Belum ada slide" sub="Seret file PPTX atau PDF ke jendela ini" />
        )}
        <div className="shade" />
        <span className="tally" data-testid="tally">
          {TALLY_TEXT[t]}
        </span>
      </div>
    </div>
  )
}
