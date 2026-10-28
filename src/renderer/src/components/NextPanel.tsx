import type { DeckMeta, SectionMeta } from '../../../shared/types'
import type { Action, ProgramState } from '../../../shared/program'
import { slideUrl } from '../../../shared/ipc'
import { currentDeck, nextStepText, nextView, webUpNext } from '../model'
import { posterWithVersion } from '../stream'
import type { WebStatus } from '../../../shared/web'
import { EndCard, VideoMark } from './Slide'
import { SlideLayers } from './SlideLayers'
import { Switch } from './Switch'

export function NextPanel({
  decks,
  sections,
  state,
  webStatuses,
  versions,
  onAction
}: {
  decks: DeckMeta[]
  sections: SectionMeta[]
  state: ProgramState
  /** Load state of the web deck pages (a web deck that is not ready cannot be taken). */
  webStatuses: Record<string, WebStatus>
  /** Per deck: bumped when its images may have been rewritten under the same names. */
  versions: Record<string, number>
  onAction(a: Action): void
}): React.JSX.Element {
  const deck = currentDeck(decks, state)
  const nx = nextView(decks, state, sections)
  // Notes of the slide on the panel: the preview while frozen, else the operator position.
  const notes = nx.kind === 'slide' && nx.held ? nx.notes : (deck?.slides[state.index]?.notes ?? '')

  const held = nx.kind === 'slide' && nx.held === true
  // A web snapshot or an edited deck's images are rewritten under the same names: the version reloads them.
  const snapshotUrl = (deckId: string, file: string): string =>
    posterWithVersion(slideUrl(deckId, file), versions[deckId] ?? 0)
  // A live native slide with animation steps left: Next plays the next step, not the next slide.
  const stepText = nextStepText(state, decks)
  const shown = state.shown
  // Web deck copy: Next goes to the live page, or the next take is a page that is not ready.
  const webText = webUpNext(state, decks, webStatuses)
  let card: React.JSX.Element
  let cap: React.ReactNode = ''
  // Position of the slide Next takes, e.g. "3 / 9"; empty at the end of a deck.
  let nextPos = ''
  if (stepText !== null && shown) {
    card = (
      <div className="slide next-slide">
        <SlideLayers
          media={{ kind: 'image', url: snapshotUrl(shown.deckId, shown.file), fit: 'fit' }}
          fade={false}
          muted
          layerClass="next-layer"
          imgAttrs={() => ({ alt: `Slide ${shown.index + 1}, the slide on air` })}
        />
      </div>
    )
    cap = stepText
  } else if (nx.kind === 'slide') {
    // Layers keep the previous slide on screen until the new image has decoded (no black frame).
    // A video slide shows its poster only; the card never plays video.
    card = (
      <div className="slide next-slide">
        <SlideLayers
          media={{
            kind: 'image',
            url: snapshotUrl(nx.deckId, nx.file),
            fit: 'fit'
          }}
          fade={false}
          muted
          layerClass="next-layer"
          imgAttrs={() => ({ alt: `Slide ${nx.index + 1}` })}
        />
        {nx.video && <VideoMark />}
      </div>
    )
    cap = `Slide ${nx.index + 1}`
    nextPos = deck ? `${nx.index + 1} / ${deck.slides.length}` : ''
  } else if (nx.kind === 'end') {
    card = <EndCard title="End of deck" />
    if (!nx.nextDeck) cap = 'No next deck'
    else if (nx.auto) cap = `Next deck: ${nx.nextDeck}`
    // Auto advance off: Next stops here; the operator picks the next deck.
    else
      cap = (
        <>
          Next stops here. Choose <strong>{nx.nextDeck}</strong> to continue.
        </>
      )
  } else if (nx.kind === 'sectionEnd') {
    if (nx.nextSection === null) card = <EndCard title="End of event" />
    else {
      card = <EndCard title="End of section" />
      cap = `Next section: ${nx.nextSection}. Press N.`
    }
  } else {
    card = <EndCard title="No slides yet" />
  }

  if (webText !== null) {
    // The live page shows its snapshot; a not-ready page keeps the card of the normal view.
    if (deck?.source === 'web' && nx.kind !== 'slide') {
      card = (
        <div className="slide next-slide">
          <SlideLayers
            media={{
              kind: 'image',
              url: snapshotUrl(deck.id, deck.slides[0].file),
              fit: 'fit'
            }}
            fade={false}
            muted
            layerClass="next-layer"
            imgAttrs={() => ({ alt: `Web page ${deck.name}` })}
          />
        </div>
      )
      nextPos = ''
    }
    cap = webText
  }

  return (
    <aside className="right" aria-label="Up next">
      <div className="colhead">
        <h2>{held ? 'Preview' : 'Up next'}</h2>
        <span className="next-pos" data-testid="next-pos">
          {nextPos}
        </span>
      </div>
      <div className="next-body">
        <div
          className="next-card"
          data-testid="next-card"
          data-kind={nx.kind}
          data-web={webText ?? undefined}
          data-held={held || undefined}
          data-step={stepText !== null || undefined}
          data-video={(nx.kind === 'slide' && nx.video) || undefined}
        >
          {card}
          <div className="cap">
            <span>{cap}</span>
          </div>
        </div>
        <div className="auto-adv">
          <label id="auto-advance-label" htmlFor="auto-advance">
            Continue to next deck
          </label>
          <Switch
            id="auto-advance"
            labelledBy="auto-advance-label"
            checked={state.autoAdvance}
            testId="auto-advance"
            onChange={(on) => onAction({ type: 'setAutoAdvance', on })}
          />
        </div>
        <div className="notes">
          <h2>Notes</h2>
          <p>{deck ? notes : ''}</p>
        </div>
      </div>
    </aside>
  )
}
