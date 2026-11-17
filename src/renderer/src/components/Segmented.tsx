import { useLayoutEffect, useRef } from 'react'

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
 * A mouse click on the console gives the focus back, so the arrows stay with the slides.
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
  // The chosen segment's fill is a thumb that glides between segments (app.css: data-glide).
  useLayoutEffect(() => {
    const group = seg.current
    if (!group) return
    const place = (): void => {
      const on = group.querySelector<HTMLElement>('[aria-checked=true]')
      if (!on) return
      group.dataset.glide = ''
      group.style.setProperty('--seg-x', `${on.offsetLeft}px`)
      group.style.setProperty('--seg-w', `${on.offsetWidth}px`)
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(group)
    return () => ro.disconnect()
  }, [value, options.length])
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
          onClick={(e) => {
            if (!disabled && o.value !== value) onChange(o.value)
            // A mouse click (detail > 0) must not leave the focus here: on the console the
            // next arrow key is Next/Prev slide, not a move inside this group. Keyboard users
            // (Tab, then arrows) keep it, and so do dialogs and popovers, which own their keys.
            if (e.detail > 0 && !e.currentTarget.closest('[role=dialog], [data-no-shortcuts]'))
              e.currentTarget.blur()
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
