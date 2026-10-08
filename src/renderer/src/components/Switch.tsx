interface Props {
  id: string
  /** Id of the element that names the switch (a visible label or title). */
  labelledBy: string
  checked: boolean
  onChange(next: boolean): void
  /** Looks and reads as disabled but stays focusable (aria-disabled), so its reason can be read. */
  disabled?: boolean
  describedBy?: string
  testId?: string
}

/**
 * The one on/off switch: the track with its knob plus the state spelled out, so the
 * state never rests on position or color alone. 40x24 px target.
 */
export function Switch({
  id,
  labelledBy,
  checked,
  onChange,
  disabled,
  describedBy,
  testId
}: Props): React.JSX.Element {
  return (
    <span className="switch-ctl">
      <button
        id={id}
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        onClick={() => {
          if (!disabled) onChange(!checked)
        }}
      >
        <span className="knob" />
      </button>
      <span className="switch-label" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </span>
  )
}
