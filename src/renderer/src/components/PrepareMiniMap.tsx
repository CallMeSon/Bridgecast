import { layout, miniMap, panFromMiniMap, type Box, type View } from '../prepare-view'

/** Fraction of the page one arrow key press moves the view. */
const KEY_STEP = 0.1

function percent(v: number, total: number): number {
  return total > 0 ? Math.round((v / total) * 100) : 0
}

/**
 * Where the 100% view sits on the page: an outline of the page and a filled
 * rectangle for the part in view. Click and drag moves the view; the arrow keys
 * move it by 10% of the page. Shown only when the page is larger than the stage.
 */
export function PrepareMiniMap({
  canvas,
  box,
  view,
  dpr,
  onPan
}: {
  canvas: Box
  box: Box
  view: View
  dpr: number
  onPan: (v: View) => void
}): React.JSX.Element | null {
  if (!layout(canvas, box, view, dpr).cropped) return null
  const map = miniMap(canvas, box, view, dpr)

  const panTo = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    onPan(panFromMiniMap(canvas, box, dpr, e.clientX - r.left, e.clientY - r.top))
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!dx && !dy) return
    e.preventDefault()
    e.stopPropagation()
    onPan({
      mode: 'actual',
      panX: view.panX + dx * canvas.width * KEY_STEP,
      panY: view.panY + dy * canvas.height * KEY_STEP
    })
  }

  // Clamped by the caller (PrepareView re-clamps every pan against the current box).
  const left = percent(view.panX, canvas.width)
  const top = percent(view.panY, canvas.height)
  const right = percent(Math.min(canvas.width, view.panX + box.width * dpr), canvas.width)
  const bottom = percent(Math.min(canvas.height, view.panY + box.height * dpr), canvas.height)

  return (
    <div
      className="prepare-map"
      role="group"
      aria-label="Page position"
      aria-describedby="prepare-map-text"
      tabIndex={0}
      style={{ width: map.width, height: map.height }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        panTo(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) panTo(e)
      }}
      onKeyDown={onKeyDown}
    >
      <span
        className="prepare-map-view"
        aria-hidden="true"
        style={{
          left: map.rect.x,
          top: map.rect.y,
          width: map.rect.w,
          height: map.rect.h
        }}
      />
      <span id="prepare-map-text" className="visually-hidden">
        Showing {left}% to {right}% across and {top}% to {bottom}% down the page. Arrow keys move
        the view.
      </span>
    </div>
  )
}
