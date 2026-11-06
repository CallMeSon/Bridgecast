import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { TOUR_STEPS, isLastStep, nextStep, previousStep, spotNumber } from '../app-tour'

/**
 * First-run tour: three cards over a scrim, then three spotlights on real controls. The
 * tour owns the keyboard while it is open (no console key reaches the Program), keeps Tab
 * inside a card, and never forces a view change: a spotlight waits for its control. A
 * spotlight has no Next button: it moves on when the operator clicks the highlighted
 * control (or, for the dialog step, when the dialog has been shown and is closed). Skip
 * ends the whole tour.
 */
interface Props {
  /** Finish or Skip: the caller marks the tour done and unmounts it. */
  onFinish(): void
}

interface Box {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 6
const GAP = 12
const TIP_W = 320
const TIP_H = 170
const EDGE = 16

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function AppTour({ onFinish }: Props): React.JSX.Element {
  const [index, setIndex] = useState(0)
  // The measured rectangle is kept with the step it belongs to, so a card or another step
  // never shows a stale ring.
  const [measured, setMeasured] = useState<{ id: string; box: Box } | null>(null)
  const step = TOUR_STEPS[index]
  const box = measured && step.kind === 'spot' && measured.id === step.id ? measured.box : null
  const seen = useRef(false)
  const tip = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  // Latest handlers for the window listeners, which are set up once.
  const latest = useRef({ index, step, onFinish })
  useEffect(() => {
    latest.current = { index, step, onFinish }
  })

  const advance = (): void => {
    const cur = latest.current.index
    if (isLastStep(cur)) latest.current.onFinish()
    else setIndex(nextStep(cur))
  }
  const back = (): void => setIndex(previousStep(latest.current.index))
  const finish = (): void => latest.current.onFinish()

  // Focus: the primary button of each step, and back to the control that had focus at start.
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  // Cards focus their primary button. A spotlight keeps focus where it was and has no button
  // to press but Skip: the operator moves on by using the highlighted control.
  useEffect(() => {
    if (step.kind === 'card') primary.current?.focus()
  }, [index, step.kind])
  useEffect(() => {
    const was = opener.current
    return () => {
      if (was && document.contains(was)) was.focus()
    }
  }, [])

  // Spotlights: follow the real control's rectangle. A 'click' step advances when the operator
  // clicks that control; a 'gone' step (the dialog) when it was there and is gone.
  useEffect(() => {
    seen.current = false
    if (step.kind !== 'spot') return
    const stepId = step.id
    const advanceWhenGone = step.advanceOn === 'gone'
    const measure = (): void => {
      const main = document.querySelector<HTMLElement>(step.target)
      if (!main && advanceWhenGone && seen.current) {
        advance()
        return
      }
      const el = main ?? (step.lead ? document.querySelector<HTMLElement>(step.lead) : null)
      if (!el) {
        setMeasured((prev) => (prev?.id === stepId ? null : prev))
        return
      }
      if (main) seen.current = true
      const r = el.getBoundingClientRect()
      const next = { top: r.top, left: r.left, width: r.width, height: r.height }
      setMeasured((prev) =>
        prev?.id === stepId && sameBox(prev.box, next) ? prev : { id: stepId, box: next }
      )
    }
    measure()
    const id = window.setInterval(measure, 250)
    addEventListener('resize', measure)
    // Capture phase: the tour sees the click, the control still does its own work.
    const onClick = (e: MouseEvent): void => {
      if (advanceWhenGone) return
      if ((e.target as Element | null)?.closest?.(step.target)) advance()
    }
    addEventListener('click', onClick, true)
    return () => {
      clearInterval(id)
      removeEventListener('resize', measure)
      removeEventListener('click', onClick, true)
    }
    // advance reads latest, so the effect only depends on the step.
  }, [index, step])

  // Keyboard: the tour takes every key except typing in a field (the Add web page dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target)) return
      if (e.key === 'Tab' && latest.current.step.kind === 'spot') return // reach the control
      if (e.key === 'Tab' && tip.current) {
        // Tab stays inside the card.
        const items = [...tip.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const to = e.shiftKey
          ? at <= 0
            ? items.length - 1
            : at - 1
          : at < 0 || at === items.length - 1
            ? 0
            : at + 1
        e.preventDefault()
        items[to].focus()
        return
      }
      // Nothing else reaches the console: Space, arrows, F, B, K and N stay with the tour.
      e.stopPropagation()
      if (e.key === 'Escape') finish()
      else if (
        e.key === 'Enter' &&
        latest.current.step.kind === 'card' &&
        (e.target as HTMLElement)?.tagName !== 'BUTTON'
      )
        advance()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
    // The listener reads the latest state through refs.
  }, [])

  const counter = spotNumber(index)
  const hasBack = index > 0

  if (step.kind === 'card') {
    return (
      <div className="tour-scrim" data-testid="app-tour">
        <div
          ref={tip}
          className="tour-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          data-step={step.id}
        >
          <h2 id="tour-title" className="tour-title">
            {step.title}
          </h2>
          <p id="tour-body" className="tour-body">
            {step.body}
          </p>
          <div className="tour-actions">
            <button
              type="button"
              className="btn sm quiet"
              onClick={finish}
              data-testid="app-tour-skip"
            >
              Skip
            </button>
            <span className="tour-spacer" />
            {hasBack && (
              <button type="button" className="btn sm" onClick={back}>
                Back
              </button>
            )}
            <button
              ref={primary}
              type="button"
              className="btn primary"
              onClick={advance}
              data-testid="app-tour-next"
            >
              {step.action}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Spotlight: the ring sits on the control (no scrim hole needed: the ring's shadow dims the rest).
  // Without the control on screen the tip still says what the step is, at the bottom right: the
  // bottom left is the Decks footer, where the controls the steps point at live.
  const placement: CSSProperties = !box
    ? { right: EDGE, bottom: EDGE }
    : box.top + box.height + PAD + GAP + TIP_H < window.innerHeight
      ? {
          top: box.top + box.height + PAD + GAP,
          left: Math.min(Math.max(box.left, EDGE), window.innerWidth - TIP_W - EDGE)
        }
      : {
          // No room below: above the control, kept inside the window.
          top: Math.max(EDGE, box.top - PAD - GAP - TIP_H),
          left: Math.min(Math.max(box.left, EDGE), window.innerWidth - TIP_W - EDGE)
        }

  return (
    <div className="tour-spot" data-testid="app-tour">
      {box ? (
        <div
          className={step.dim === false ? 'tour-ring tour-ring-plain' : 'tour-ring'}
          aria-hidden="true"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2
          }}
        />
      ) : null}
      <div
        ref={tip}
        className="tour-tip"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-tip-title"
        aria-describedby="tour-tip-body"
        data-step={step.id}
        key={step.id}
        style={placement}
      >
        {counter && (
          <p className="tour-count num">
            {counter.n} / {counter.total}
          </p>
        )}
        <h2 id="tour-tip-title" className="tour-tip-title">
          {step.title}
        </h2>
        <p id="tour-tip-body" className="tour-tip-body">
          {step.body}
        </p>
        <div className="tour-actions">
          <button
            type="button"
            className="btn sm quiet"
            onClick={finish}
            data-testid="app-tour-skip"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
