import { useId } from 'react'
import { CaretDownIcon } from '@phosphor-icons/react'

interface Props {
  title: string
  open: boolean
  onToggle(open: boolean): void
  testId?: string
  children: React.ReactNode
}

/**
 * One collapsible section of the right panel. The body stays mounted while closed
 * (hidden), so a control keeps its state and a pending save is never lost.
 */
export function PanelSection({
  title,
  open,
  onToggle,
  testId,
  children
}: Props): React.JSX.Element {
  const id = useId()
  return (
    <section className="sec" data-open={open} data-testid={testId}>
      <h2 className="sec-h">
        <button
          type="button"
          className="sh"
          id={`${id}-h`}
          aria-expanded={open}
          aria-controls={`${id}-b`}
          onClick={() => onToggle(!open)}
        >
          {title}
          <CaretDownIcon className="chev" size={16} aria-hidden="true" />
        </button>
      </h2>
      <div className="sb" id={`${id}-b`} role="group" aria-labelledby={`${id}-h`} hidden={!open}>
        {children}
      </div>
    </section>
  )
}
