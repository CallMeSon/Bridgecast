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
import { panPress, type PanDir } from '../../../shared/pan-hold'
import { ZOOM_MAX, isZoomed, panDisabled, type Zoom } from '../../../shared/zoom'

const nowMs = (): number => performance.now()

const ARROWS: { dir: PanDir; label: string; icon: React.ReactNode }[] = [
  { dir: 'left', label: 'Pan left', icon: <CaretLeftIcon size={16} weight="bold" /> },
  { dir: 'up', label: 'Pan up', icon: <CaretUpIcon size={16} weight="bold" /> },
  { dir: 'down', label: 'Pan down', icon: <CaretDownIcon size={16} weight="bold" /> },
  { dir: 'right', label: 'Pan right', icon: <CaretRightIcon size={16} weight="bold" /> }
]

/**
 * Pan arrows: a click is one big step, holding pans smoothly (pan-hold.ts). The hold sends one
 * zoomPan per animation frame, so it never floods IPC. Enter/Space work like a press.
 */
function PanPad({
  zoom,
  disabled,
  onAction
}: {
  zoom: Zoom
  disabled: boolean
  onAction(a: Action): void
}): React.JSX.Element {
  const edge = panDisabled(zoom)
  const live = useRef(onAction)
  useEffect(() => {
    live.current = onAction
  })
  const active = useRef<{ dir: PanDir; press: ReturnType<typeof panPress>; raf: number } | null>(
    null
  )
  const stop = (tap: boolean): void => {
    const a = active.current
    if (!a) return
    active.current = null
    cancelAnimationFrame(a.raf)
    const d = tap ? a.press.release(nowMs()) : null
    if (d) live.current({ type: 'zoomPan', ...d })
  }
  const start = (dir: PanDir): void => {
    if (active.current) return
    const press = panPress(dir, nowMs())
    const a = { dir, press, raf: 0 }
    const loop = (now: number): void => {
      const d = press.tick(now)
      if (d) live.current({ type: 'zoomPan', ...d })
      a.raf = requestAnimationFrame(loop)
    }
    a.raf = requestAnimationFrame(loop)
    active.current = a
  }
  // A held arrow stops at its edge (the button turns disabled), and on unmount.
  useEffect(() => {
    if (active.current && (disabled || edge[active.current.dir])) stop(false)
  })
  useEffect(() => () => stop(false), [])
  return (
    <div className="pgm-zoom-pad" role="group" aria-label="Pan">
      {ARROWS.map(({ dir, label, icon }) => (
        <button
          key={dir}
          type="button"
          className="pgm-zoom-btn"
          aria-label={label}
          title={`${label} (hold to keep moving)`}
          disabled={disabled || edge[dir]}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            start(dir)
          }}
          onPointerUp={() => stop(true)}
          onPointerCancel={() => stop(false)}
          onLostPointerCapture={() => stop(false)}
          onBlur={() => stop(false)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            if (!e.repeat) start(dir)
          }}
          onKeyUp={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            stop(true)
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}

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
      <PanPad zoom={zoom} disabled={disabled} onAction={onAction} />
      <span className="pgm-zoom-hint" aria-hidden="true">
        Ctrl+scroll to zoom, drag to move
      </span>
    </div>
  )
}
