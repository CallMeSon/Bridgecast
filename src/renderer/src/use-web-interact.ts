import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from 'react'
import type { PrepareInput } from '../../shared/web'
import { toPrepareChar, toPrepareInput, toPrepareKey } from './model'

/**
 * The page input of one key event: the key itself and, on keydown, the typed character
 * (the page needs both to type). Pure, so it is tested without a DOM.
 */
export function keyInputs(e: KeyboardEvent): PrepareInput[] {
  const key = toPrepareKey(e)
  if (!key) return []
  if (e.type !== 'keydown') return [key]
  const typed = toPrepareChar(e)
  return typed ? [key, typed] : [key]
}

let claims = 0

/**
 * Claims the keys for an Interact capture: the app's shortcuts (Space, arrows, F, B, K ...)
 * stand aside while the returned release has not run.
 */
export function claimKeys(): () => void {
  claims += 1
  let held = true
  return () => {
    if (!held) return
    held = false
    claims -= 1
  }
}

/** True while an Interact capture holds the keys. */
export function keysClaimed(): boolean {
  return claims > 0
}

export interface WebInteractCapture {
  /** Input is sent only while true (Interact is on). */
  active: boolean
  /** The drawn page: pointer positions are 0 to 1 of this element's rectangle. */
  page: RefObject<HTMLElement | null>
  /** Sends one input to the page; what a refusal means is the caller's to show. */
  send: (input: PrepareInput) => void
}

export interface WebInteractHandlers {
  /** Press, release and move on the page (one handler for all three). */
  onMouse: (e: ReactMouseEvent) => void
  onMouseLeave: (e: ReactMouseEvent) => void
  onWheel: (e: ReactWheelEvent) => void
  /** Keydown and keyup. Esc and F6 are decided by the caller (keyRoute). */
  onKey: (e: ReactKeyboardEvent) => void
  /** The pointer leaves the page on purpose (Interact turned off): hover menus close. */
  release: () => void
}

/**
 * Pointer, wheel and key capture of a web page, shared by the Prepare window and the
 * operator monitor. Each event is mapped against the page rectangle and sent with `send`,
 * one move per frame. A press that the caller wants for itself (a pan) is not sent: the
 * caller checks it before calling `onMouse`.
 */
export function useWebInteract({ active, page, send }: WebInteractCapture): WebInteractHandlers {
  const pendingMove = useRef<MouseEvent | null>(null)
  const moveFrame = useRef(0)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  // A mapped input that is null (outside the page, an unknown key) is simply not sent.
  const emit = useCallback(
    (input: PrepareInput | null): void => {
      if (input) send(input)
    },
    [send]
  )

  useEffect(() => () => cancelAnimationFrame(moveFrame.current), [])

  // A button released outside the page still ends the press on the page (clamped to its edge).
  useEffect(() => {
    const onUp = (e: MouseEvent): void => {
      if (!dragging.current) return
      dragging.current = false
      const r = page.current?.getBoundingClientRect()
      if (!r || !active) return
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        return
      const clamped = {
        type: 'mouseup',
        button: e.button,
        detail: 1,
        clientX: Math.min(Math.max(e.clientX, r.left), r.right),
        clientY: Math.min(Math.max(e.clientY, r.top), r.bottom)
      } as MouseEvent
      emit(toPrepareInput(clamped, r))
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [active, page, emit])

  const onMouse = (e: ReactMouseEvent): void => {
    if (!active) return
    const r = page.current?.getBoundingClientRect()
    if (!r) return
    if (e.type === 'mousemove') {
      lastPoint.current = { x: e.clientX, y: e.clientY }
      pendingMove.current = e.nativeEvent
      if (!moveFrame.current) {
        moveFrame.current = requestAnimationFrame(() => {
          moveFrame.current = 0
          const m = pendingMove.current
          pendingMove.current = null
          const rect = page.current?.getBoundingClientRect()
          if (m && rect) emit(toPrepareInput(m, rect))
        })
      }
      return
    }
    if (e.type === 'mousedown') dragging.current = true
    if (e.type === 'mouseup') dragging.current = false
    emit(toPrepareInput(e.nativeEvent, r))
  }

  // Leaving the page tells the page the pointer left, so a hover menu does not stay open.
  const onMouseLeave = (e: ReactMouseEvent): void => {
    cancelAnimationFrame(moveFrame.current)
    moveFrame.current = 0
    pendingMove.current = null
    const had = lastPoint.current
    lastPoint.current = null
    const r = page.current?.getBoundingClientRect()
    if (!active || dragging.current || !had || !r) return
    emit(leaveAt(e.clientX, e.clientY, r))
  }

  const onWheel = (e: ReactWheelEvent): void => {
    if (!active) return
    const r = page.current?.getBoundingClientRect()
    if (!r) return
    emit(toPrepareInput(e.nativeEvent, r))
  }

  const onKey = (e: ReactKeyboardEvent): void => {
    if (!active || !page.current) return
    e.preventDefault()
    for (const input of keyInputs(e.nativeEvent)) send(input)
  }

  const release = useCallback((): void => {
    const had = lastPoint.current
    lastPoint.current = null
    const r = page.current?.getBoundingClientRect()
    if (active && had && r) emit(leaveAt(had.x, had.y, r))
  }, [active, page, emit])

  return { onMouse, onMouseLeave, onWheel, onKey, release }
}

/** A pointer that left the page at (x, y): the page gets a mouseLeave at its edge. */
function leaveAt(x: number, y: number, r: DOMRect): PrepareInput | null {
  return toPrepareInput(
    { type: 'mouseleave', clientX: x, clientY: y, button: 0, detail: 0 } as MouseEvent,
    r
  )
}
