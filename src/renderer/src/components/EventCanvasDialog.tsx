import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from '@phosphor-icons/react'
import type { Canvas } from '../../../shared/canvas'
import type { EventMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { pickDisplay, type DisplayInfo } from '../../../shared/displays'
import { needsCanvasConfirm } from '../model'
import { useNdiStatus, useOmtStatus } from '../omt'
import { hasConnections } from '../../../shared/omt'
import { CanvasSetting } from './CanvasPicker'

interface Props {
  event: EventMeta
  program: ProgramState
  onSaved(ev: EventMeta): void
  /** Closes the dialog; `restoreFocus` is false when the click went elsewhere. */
  onClose(restoreFocus: boolean): void
}

/**
 * "Canvas for this event": the event's own output size, or Use default to
 * follow the machine canvas of the output settings. A centred modal like AddWebDialog,
 * in a portal so a short window cannot clip it; Escape, Close or a click outside closes it.
 */
export function EventCanvasDialog({ event, program, onSaved, onClose }: Props): React.JSX.Element {
  const api = window.api
  const box = useRef<HTMLDivElement>(null)
  const [hdmiDisplay, setHdmiDisplay] = useState<DisplayInfo | null>(null)
  const [machine, setMachine] = useState<Canvas | null>(null)
  const omt = useOmtStatus()
  const ndi = useNdiStatus()

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [s, displays] = await Promise.all([api.getSettings(), api.listDisplays()])
      if (!alive) return
      setHdmiDisplay(pickDisplay(displays, s.hdmi.displayId))
      setMachine(s.canvas)
    }
    void load()
    const off = api.onDisplaysChanged(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [api])

  useEffect(() => {
    // The current choice; with a custom size, its Width field.
    const root = box.current
    const to =
      root?.querySelector<HTMLElement>('.canvas-opt[aria-pressed="true"]') ??
      root?.querySelector<HTMLElement>('.canvas-custom input')
    to?.focus()
    // pointerdown, not click: the click that opened this dialog is already over.
    const onPointer = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) onClose(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose(true)
    }
    // Capture: the scrim stops these from reaching the right panel through the React tree.
    addEventListener('pointerdown', onPointer, true)
    addEventListener('keydown', onKey, true)
    return () => {
      removeEventListener('pointerdown', onPointer, true)
      removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  // Portal events still bubble to the React parent (the Canvas row of the right panel).
  const contain = (e: React.SyntheticEvent): void => e.stopPropagation()
  return createPortal(
    <div
      className="modal-scrim"
      onClick={contain}
      onKeyDown={contain}
      onKeyUp={contain}
      onPointerDown={contain}
    >
      <div
        ref={box}
        className="popover modal canvas-modal canvas-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-canvas-title"
        data-no-shortcuts
        data-testid="event-canvas-dialog"
      >
        <section className="pop-section">
          <div className="pop-head">
            <h2 className="pop-title" id="event-canvas-title">
              Canvas for this event
            </h2>
            <button className="btn sm" onClick={() => onClose(true)}>
              <XIcon size={14} />
              Close
            </button>
          </div>
          <p className="hint">
            {event.name}. Use default follows the canvas in the output settings.
          </p>
          <CanvasSetting
            value={event.canvas ?? null}
            allowDefault
            hdmiDisplay={hdmiDisplay}
            defaultCanvas={machine}
            confirm={needsCanvasConfirm(program, event.id)}
            networkReceivers={hasConnections(omt, ndi)}
            apply={async (c) => onSaved(await api.setEventCanvas(event.id, c))}
          />
        </section>
      </div>
    </div>,
    document.body
  )
}
