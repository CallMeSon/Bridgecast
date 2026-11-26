import {
  ArrowCounterClockwiseIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon
} from '@phosphor-icons/react'
import type { Action } from '../../../shared/program'
import { ZOOM_MAX, isZoomed, type Zoom } from '../../../shared/zoom'

/**
 * Zoom buttons of the Program output. Pointer zoom and pan happen on the monitor itself
 * (use-monitor-zoom.ts). Everything dispatches reducer actions; the reducer clamps.
 */
export function ZoomControls({
  zoom,
  disabled,
  onAction
}: {
  zoom: Zoom
  disabled: boolean
  onAction(a: Action): void
}): React.JSX.Element {
  const zoomed = isZoomed(zoom)
  return (
    <div className="pgm-zoom" data-testid="zoom-controls" role="group" aria-label="Zoom">
      <div className="pgm-zoom-row">
        <button
          type="button"
          className="pgm-zoom-btn"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={disabled || !zoomed}
          onClick={() => onAction({ type: 'zoomOut' })}
        >
          <MagnifyingGlassMinusIcon size={18} weight="bold" aria-hidden="true" />
        </button>
        <span className="pgm-zoom-scale mono" aria-live="polite" data-testid="zoom-scale">
          {Number(zoom.scale.toFixed(2))}x
        </span>
        <button
          type="button"
          className="pgm-zoom-btn"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={disabled || zoom.scale >= ZOOM_MAX}
          onClick={() => onAction({ type: 'zoomIn' })}
        >
          <MagnifyingGlassPlusIcon size={18} weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pgm-zoom-btn"
          aria-label="Reset zoom"
          title="Reset zoom"
          disabled={disabled || !zoomed}
          onClick={() => onAction({ type: 'zoomReset' })}
        >
          <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <span className="pgm-zoom-hint" aria-hidden="true">
        Ctrl+scroll to zoom, drag to move
      </span>
    </div>
  )
}
