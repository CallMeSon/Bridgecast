import { useEffect, useRef, type RefObject } from 'react'
import type { Action } from '../../shared/program'
import { centreOn, coalesce, isZoomed, viewRect, zoomAtPoint, type Zoom } from '../../shared/zoom'

const frame = (run: () => void): void => {
  requestAnimationFrame(run)
}

/**
 * Pointer zoom and pan on the Program monitor, mapped against the visible picture (the
 * screen box): Ctrl+wheel (and a trackpad pinch) zooms about the pointer, a plain wheel and a
 * drag pan while zoomed, a double click resets. One action per animation frame, so a drag
 * never floods IPC. `enabled` is false while zoom does not apply or Interact owns the pointer.
 */
export function useMonitorZoom(
  screen: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  zoom: Zoom,
  onAction: (a: Action) => void
): void {
  const live = useRef({ zoom, onAction })
  // Last zoom we asked for, so several wheel events in one frame compound.
  const target = useRef(zoom)
  const gestureAt = useRef(0)
  useEffect(() => {
    live.current = { zoom, onAction }
    // A state still on its way back must not undo a gesture in progress.
    if (Date.now() - gestureAt.current > 250) target.current = zoom
  }, [zoom, onAction])

  useEffect(() => {
    const el = screen.current
    if (!el || !enabled) return
    const set = coalesce<Zoom>(
      (z) => live.current.onAction({ type: 'zoomSet', scale: z.scale, cx: z.cx, cy: z.cy }),
      frame
    )
    let wheelPan = { dx: 0, dy: 0 }
    let panQueued = false
    const flushPan = (): void => {
      panQueued = false
      const { dx, dy } = wheelPan
      wheelPan = { dx: 0, dy: 0 }
      live.current.onAction({ type: 'zoomPan', dx, dy })
    }
    const frac = (e: MouseEvent): { px: number; py: number; w: number; h: number } => {
      const b = el.getBoundingClientRect()
      return {
        px: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
        py: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
        w: b.width,
        h: b.height
      }
    }
    const onWheel = (e: WheelEvent): void => {
      // Never let Ctrl+wheel zoom the whole window, and keep the wheel from scrolling it.
      e.preventDefault()
      const { px, py, w, h } = frac(e)
      if (e.ctrlKey) {
        const next = zoomAtPoint(target.current, Math.exp(-e.deltaY * 0.01), px, py)
        target.current = next
        gestureAt.current = Date.now()
        set.push(next)
        return
      }
      if (!isZoomed(target.current)) return
      wheelPan.dx += e.deltaX / w
      wheelPan.dy += e.deltaY / h
      if (!panQueued) {
        panQueued = true
        requestAnimationFrame(flushPan)
      }
    }
    let drag: { x: number; y: number; z: Zoom } | null = null
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || !isZoomed(live.current.zoom)) return
      drag = { x: e.clientX, y: e.clientY, z: target.current }
      el.setPointerCapture(e.pointerId)
      el.dataset.panning = 'true'
    }
    const onMove = (e: PointerEvent): void => {
      if (!drag) return
      const { w, h } = frac(e)
      const win = viewRect(drag.z).w
      const c = centreOn(
        drag.z,
        drag.z.cx - ((e.clientX - drag.x) / w) * win,
        drag.z.cy - ((e.clientY - drag.y) / h) * win
      )
      target.current = c
      gestureAt.current = Date.now()
      set.push(c)
    }
    const onUp = (): void => {
      drag = null
      delete el.dataset.panning
      set.flush()
    }
    const onDouble = (): void => live.current.onAction({ type: 'zoomReset' })
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('dblclick', onDouble)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('dblclick', onDouble)
      delete el.dataset.panning
    }
  }, [screen, enabled])
}
