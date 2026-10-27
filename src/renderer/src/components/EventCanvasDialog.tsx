import { useEffect, useRef, useState } from 'react'
import { XIcon } from '@phosphor-icons/react'
import type { EventMeta } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { pickDisplay, type DisplayInfo } from '../../../shared/displays'
import { needsCanvasConfirm } from '../model'
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
 * follow the machine canvas of the output settings. Opens from the event menu,
 * under it; Escape, Close or a click outside closes it.
 */
export function EventCanvasDialog({ event, program, onSaved, onClose }: Props): React.JSX.Element {
  const api = window.api
  const box = useRef<HTMLDivElement>(null)
  const [hdmiDisplay, setHdmiDisplay] = useState<DisplayInfo | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [s, displays] = await Promise.all([api.getSettings(), api.listDisplays()])
      if (alive) setHdmiDisplay(pickDisplay(displays, s.hdmi.displayId))
    }
    void load()
    const off = api.onDisplaysChanged(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [api])

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role=radio][tabindex="0"]')?.focus()
    // pointerdown, not click: the click that opened this dialog is already over.
    const onPointer = (e: PointerEvent): void => {
      if (!box.current?.parentElement?.contains(e.target as Node)) onClose(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose(true)
    }
    addEventListener('pointerdown', onPointer)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('pointerdown', onPointer)
      removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={box}
      className="popover canvas-dialog"
      role="dialog"
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
        <p className="hint">{event.name}. Use default follows the canvas in the output settings.</p>
        <CanvasSetting
          value={event.canvas ?? null}
          allowDefault
          hdmiDisplay={hdmiDisplay}
          confirm={needsCanvasConfirm(program)}
          apply={async (c) => onSaved(await api.setEventCanvas(event.id, c))}
        />
      </section>
    </div>
  )
}
