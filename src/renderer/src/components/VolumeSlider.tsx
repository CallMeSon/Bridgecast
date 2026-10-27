interface Props {
  id: string
  label: string
  /** Integer 0–100. */
  value: number
  onChange(next: number): void
  testId?: string
}

/**
 * The one volume control: a labelled range 0–100 with the number beside it, so the
 * level never rests on the thumb position alone. Arrow keys step by 1, PageUp/PageDown
 * by 10 (native range behaviour); the panel that hosts it is `data-no-shortcuts`.
 */
export function VolumeSlider({ id, label, value, onChange, testId }: Props): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="level">
        <input
          id={id}
          className="level-range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-valuetext={`${value}%`}
          data-testid={testId}
          style={{ '--p': `${value}%` } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {/* aria-live off: the range itself announces its value; the number is for the eye. */}
        <output className="level-num" htmlFor={id} aria-live="off">
          {value}%
        </output>
      </div>
    </div>
  )
}
