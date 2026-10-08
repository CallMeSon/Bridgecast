import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  clampSize,
  limits,
  parseStored,
  resolveLayout,
  serializeStored,
  STEP,
  type Axis,
  type Layout,
  type Stored
} from '../layout'

const KEY = 'panel-layout'

function load(): Stored {
  try {
    return parseStored(localStorage.getItem(KEY))
  } catch {
    return {}
  }
}

function save(s: Stored): void {
  try {
    localStorage.setItem(KEY, serializeStored(s))
  } catch {
    // Storage can be unavailable; the sizes still apply for this session.
  }
}

const VARS: Record<Axis, string> = { left: '--left-w', right: '--right-w', strip: '--strip-h' }

const LABEL: Record<Axis, string> = {
  left: 'Ubah lebar panel deck',
  right: 'Ubah lebar panel slide berikutnya',
  strip: 'Ubah tinggi strip slide'
}

/** Which way a pointer delta grows each panel. */
const SIGN: Record<Axis, { x: number; y: number }> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  strip: { x: 0, y: -1 }
}

const KEYS: Record<Axis, Record<string, number>> = {
  left: { ArrowRight: STEP, ArrowLeft: -STEP },
  right: { ArrowLeft: STEP, ArrowRight: -STEP },
  strip: { ArrowUp: STEP, ArrowDown: -STEP }
}

type Drag = { x: number; y: number; size: number }

type SplitterProps = {
  axis: Axis
  value: number
  min: number
  max: number
  /** Live size while dragging: CSS only, no React render. Returns the clamped size. */
  onMove: (axis: Axis, size: number) => number
  /** Size to keep (a number) or reset to default (null). */
  onCommit: (axis: Axis, size: number | null) => void
  /** Size currently on screen. */
  current: (axis: Axis) => number
  onDragging: (on: boolean) => void
}

function Splitter(p: SplitterProps): React.JSX.Element {
  const { axis, onMove, onCommit, current, onDragging } = p
  const drag = useRef<Drag | null>(null)

  const end = (el: HTMLDivElement): void => {
    const d = drag.current
    if (!d) return
    drag.current = null
    delete el.dataset.dragging
    onDragging(false)
    // A mouse drag or click must not leave focus here: the splitter swallows
    // Space (data-no-shortcuts), so the next Space would not take Next.
    el.blur()
    // A plain click leaves the size (and the stored preference) alone.
    if (current(axis) !== d.size) onCommit(axis, current(axis))
  }

  return (
    <div
      className="splitter"
      data-axis={axis}
      role="separator"
      tabIndex={0}
      aria-orientation={axis === 'strip' ? 'horizontal' : 'vertical'}
      aria-label={LABEL[axis]}
      aria-valuenow={p.value}
      aria-valuemin={p.min}
      aria-valuemax={p.max}
      data-no-shortcuts=""
      data-testid={`splitter-${axis}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, size: current(axis) }
        e.currentTarget.dataset.dragging = ''
        onDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const s = SIGN[axis]
        const size = onMove(axis, d.size + s.x * (e.clientX - d.x) + s.y * (e.clientY - d.y))
        e.currentTarget.setAttribute('aria-valuenow', String(size))
      }}
      onPointerUp={(e) => end(e.currentTarget)}
      // Capture lost without a pointerup (cancel): keep what is on screen.
      onLostPointerCapture={(e) => end(e.currentTarget)}
      onDoubleClick={() => onCommit(axis, null)}
      onKeyDown={(e) => {
        // Home / End jump to the smallest / largest size the window allows.
        const to = e.key === 'Home' ? p.min : e.key === 'End' ? p.max : undefined
        const step = KEYS[axis][e.key]
        if (to === undefined && step === undefined) return
        e.preventDefault()
        onCommit(axis, onMove(axis, to ?? current(axis) + (step ?? 0)))
      }}
    />
  )
}

/**
 * Drag handles between the panels. Sizes live in CSS custom properties on the
 * root element, so dragging never re-renders React; state is committed (and
 * saved) when the drag, key press or reset ends.
 */
export function Splitters({
  appRef
}: {
  appRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const [initial] = useState(load)
  const stored = useRef<Stored>(initial)
  const [dims, setDims] = useState({ w: innerWidth, h: innerHeight })
  const [layout, setLayout] = useState<Layout>(() =>
    resolveLayout(initial, innerWidth, innerHeight)
  )
  const live = useRef(layout)
  // A drag in progress owns the live sizes; a resize meanwhile must not reset them.
  const dragging = useRef(false)

  // On <html>, not .app: a child's layout effect runs before the parent's ref
  // is attached, and the sizes must be in place before the first paint.
  const paint = useCallback((axis: Axis, v: number) => {
    document.documentElement.style.setProperty(VARS[axis], `${v}px`)
  }, [])

  useLayoutEffect(() => {
    live.current = layout
    for (const a of Object.keys(VARS) as Axis[]) paint(a, layout[a])
  }, [layout, paint])

  useEffect(() => {
    const onResize = (): void => {
      setDims({ w: innerWidth, h: innerHeight })
      if (dragging.current) return
      setLayout(resolveLayout(stored.current, innerWidth, innerHeight))
    }
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])

  const onMove = useCallback(
    (axis: Axis, v: number): number => {
      const size = clampSize(axis, v, live.current, innerWidth, innerHeight)
      live.current = { ...live.current, [axis]: size }
      paint(axis, size)
      return size
    },
    [paint]
  )

  const onCommit = useCallback((axis: Axis, v: number | null): void => {
    if (v === null) delete stored.current[axis]
    else stored.current[axis] = v
    save(stored.current)
    setLayout(resolveLayout(stored.current, innerWidth, innerHeight))
  }, [])

  const current = useCallback((axis: Axis): number => live.current[axis], [])

  const onDragging = useCallback(
    (on: boolean): void => {
      dragging.current = on
      // Drag over: re-clamp to the window as it is now (a resize may have happened).
      if (!on) setLayout(resolveLayout(stored.current, innerWidth, innerHeight))
      const el = appRef.current
      if (!el) return
      if (on) el.dataset.resizing = ''
      else delete el.dataset.resizing
    },
    [appRef]
  )

  return (
    <>
      {(['left', 'right', 'strip'] as const).map((axis) => (
        <Splitter
          key={axis}
          axis={axis}
          value={layout[axis]}
          {...limits(axis, layout, dims.w, dims.h)}
          onMove={onMove}
          onCommit={onCommit}
          current={current}
          onDragging={onDragging}
        />
      ))}
    </>
  )
}
