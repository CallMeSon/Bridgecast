import { useEffect, useRef } from 'react'
import {
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon
} from '@phosphor-icons/react'
import type { Action } from '../../../shared/program'
import {
  PAN_STEP,
  ZOOM_MAX,
  coalesce,
  isZoomed,
  panDisabled,
  pointToCentre,
  viewRect,
  type Zoom
} from '../../../shared/zoom'
import type { outputSource } from '../model'

const pct = (n: number): number => Math.round(n * 100)

/** The still behind the minimap rectangle: the live image, or a poster; else a neutral tile. */
function stillUrl(media: ReturnType<typeof outputSource>): string | null {
  if (!media) return null
  if (media.kind === 'image') return media.url
  if (media.kind === 'pdf' || media.kind === 'video' || media.kind === 'stream') return media.poster
  return null
}

/**
 * Zoom and pan of the Program output: buttons plus a minimap of the whole picture with the
 * visible window. Everything dispatches reducer actions; the reducer clamps.
 */
export function ZoomControls({
  zoom,
  canvas,
  disabled,
  media,
  onAction
}: {
  zoom: Zoom
  canvas: { width: number; height: number }
  disabled: boolean
  media: ReturnType<typeof outputSource>
  onAction(a: Action): void
}): React.JSX.Element {
  const zoomed = isZoomed(zoom)
  const edge = panDisabled(zoom)
  const r = viewRect(zoom)
  const still = stillUrl(media)
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  // One zoomTo per animation frame while dragging.
  const drag = useRef<ReturnType<typeof coalesce<{ cx: number; cy: number }>> | null>(null)
  useEffect(() => {
    drag.current = coalesce<{ cx: number; cy: number }>(
      (c) => onAction({ type: 'zoomTo', cx: c.cx, cy: c.cy }),
      (run) => {
        requestAnimationFrame(run)
      }
    )
  }, [onAction])
  const point = (e: React.PointerEvent): { cx: number; cy: number } | null => {
    const b = box.current?.getBoundingClientRect()
    if (!b || b.width === 0 || b.height === 0) return null
    return pointToCentre((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height)
  }
  const minimapOff = disabled || !zoomed
  const pan = (dx: number, dy: number): void => onAction({ type: 'zoomPan', dx, dy })
  const arrow = (
    label: string,
    off: boolean,
    dx: number,
    dy: number,
    icon: React.ReactNode,
    cls: string
  ): React.JSX.Element => (
    <button
      type="button"
      className={`pgm-zoom-btn ${cls}`}
      aria-label={label}
      title={label}
      disabled={disabled || off}
      onClick={() => pan(dx, dy)}
    >
      {icon}
    </button>
  )
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
      <div className="pgm-zoom-pad">
        {arrow(
          'Pan up',
          edge.up,
          0,
          -PAN_STEP,
          <CaretUpIcon size={16} weight="bold" aria-hidden="true" />,
          'pan-up'
        )}
        {arrow(
          'Pan left',
          edge.left,
          -PAN_STEP,
          0,
          <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />,
          'pan-left'
        )}
        {arrow(
          'Pan right',
          edge.right,
          PAN_STEP,
          0,
          <CaretRightIcon size={16} weight="bold" aria-hidden="true" />,
          'pan-right'
        )}
        {arrow(
          'Pan down',
          edge.down,
          0,
          PAN_STEP,
          <CaretDownIcon size={16} weight="bold" aria-hidden="true" />,
          'pan-down'
        )}
      </div>
      <div className="pgm-zoom-map" role="group" aria-label="Zoom position">
        <div
          ref={box}
          className="pgm-zoom-box"
          data-off={minimapOff}
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
          onPointerDown={(e) => {
            if (minimapOff) return
            const c = point(e)
            if (!c) return
            e.currentTarget.setPointerCapture(e.pointerId)
            dragging.current = true
            onAction({ type: 'zoomTo', cx: c.cx, cy: c.cy })
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return
            const c = point(e)
            if (c) drag.current?.push(c)
          }}
          onPointerUp={() => {
            dragging.current = false
            drag.current?.flush()
          }}
          onPointerCancel={() => {
            dragging.current = false
            drag.current?.flush()
          }}
        >
          {still && <img className="pgm-zoom-still" src={still} alt="" draggable={false} />}
          <div
            className="pgm-zoom-view"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`
            }}
          />
        </div>
        <span className="visually-hidden">
          Zoom centre {pct(zoom.cx)}% / {pct(zoom.cy)}%
        </span>
      </div>
    </div>
  )
}
