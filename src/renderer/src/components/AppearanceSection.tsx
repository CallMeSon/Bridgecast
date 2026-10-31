import { useRef } from 'react'
import { CheckIcon } from '@phosphor-icons/react'
import {
  ACCENTS,
  ACCENT_IDS,
  deriveAccent,
  type AccentTokens,
  type AccentId,
  type Theme,
  type ThemePref
} from '../appearance'
import { Segmented } from './Segmented'
import { Switch } from './Switch'

interface Props {
  theme: Theme
  themePref: ThemePref
  onThemePref(p: ThemePref): void
  accent: AccentId
  onAccent(a: AccentId): void
  customHex: string
  onCustomHex(hex: string): void
  reduceMotion: boolean
  onReduceMotion(on: boolean): void
}

const THEMES: readonly { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const NAMES: Record<AccentId, string> = {
  orange: 'Orange',
  violet: 'Violet',
  blue: 'Blue',
  rose: 'Rose',
  sand: 'Sand',
  custom: 'Custom'
}

export function AppearanceSection(p: Props): React.JSX.Element {
  const grid = useRef<HTMLDivElement>(null)
  const derived = deriveAccent(p.customHex, p.theme)
  const tokens = (id: AccentId): AccentTokens => (id === 'custom' ? derived : ACCENTS[id][p.theme])

  const onKey = (e: React.KeyboardEvent): void => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!dir) return
    e.preventDefault()
    e.stopPropagation()
    const to = (ACCENT_IDS.indexOf(p.accent) + dir + ACCENT_IDS.length) % ACCENT_IDS.length
    p.onAccent(ACCENT_IDS[to])
    grid.current?.querySelectorAll<HTMLElement>('[role=radio]')[to]?.focus()
  }

  return (
    <>
      <section className="set-section" aria-labelledby="set-theme">
        <h3 id="set-theme">Theme</h3>
        <Segmented
          label="Theme"
          value={p.themePref}
          options={THEMES}
          testId="settings-theme"
          onChange={p.onThemePref}
        />
        <p className="hint">Auto follows Windows.</p>
      </section>
      <section className="set-section" aria-labelledby="set-accent">
        <h3 id="set-accent">Accent</h3>
        <div
          ref={grid}
          className="swatches"
          role="radiogroup"
          aria-labelledby="set-accent"
          onKeyDown={onKey}
        >
          {ACCENT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              className="swatch"
              aria-checked={p.accent === id}
              tabIndex={p.accent === id ? 0 : -1}
              data-testid={`accent-${id}`}
              onClick={() => p.onAccent(id)}
            >
              <span
                className="chip"
                style={{ '--sw': tokens(id).fill, color: tokens(id).on } as React.CSSProperties}
              >
                {p.accent === id && <CheckIcon size={14} weight="bold" />}
              </span>
              {NAMES[id]}
            </button>
          ))}
        </div>
        {p.accent === 'custom' && (
          <div className="custom-accent">
            <label htmlFor="custom-accent-input">Colour</label>
            <input
              id="custom-accent-input"
              type="color"
              value={p.customHex}
              data-testid="custom-accent-input"
              onChange={(e) => p.onCustomHex(e.target.value)}
            />
            <span className="hint">
              Used as <span className="num">{derived.fill}</span> on controls and{' '}
              <span className="num">{derived.ink}</span> as text, adjusted to stay readable.
            </span>
          </div>
        )}
      </section>
      <section className="set-section" aria-labelledby="set-motion">
        <div className="set-row">
          <div>
            <h3 id="set-motion">Reduce motion</h3>
            <p className="hint">
              Turns off small interface animations. The Fade you choose is not affected.
            </p>
          </div>
          <Switch
            id="reduce-motion"
            labelledBy="set-motion"
            checked={p.reduceMotion}
            onChange={p.onReduceMotion}
            testId="settings-reduce-motion"
          />
        </div>
      </section>
    </>
  )
}
