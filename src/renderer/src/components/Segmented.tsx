import { useRef } from 'react'

interface Props<T extends string | number> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  disabled?: boolean
  testId?: string
  onChange(v: T): void
}

/**
 * Radio group of buttons (the .seg look of Transition): one tab stop, the arrows
 * move and choose inside it. The chosen segment also carries a bar, not fill alone.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  disabled,
  testId,
  onChange
}: Props<T>): React.JSX.Element {
  const seg = useRef<HTMLDivElement>(null)
  const onKey = (e: React.KeyboardEvent): void => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    if (!dir || disabled) return
    e.preventDefault()
    e.stopPropagation()
    const at = options.findIndex((o) => o.value === value)
    const to = (at + dir + options.length) % options.length
    onChange(options[to].value)
    seg.current?.querySelectorAll<HTMLElement>('[role=radio]')[to]?.focus()
  }
  return (
    <div
      ref={seg}
      className="seg fill"
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKey}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-disabled={disabled || undefined}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => {
            if (!disabled && o.value !== value) onChange(o.value)
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
