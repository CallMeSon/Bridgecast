import { useEffect, useRef, useState } from 'react'
import { MonitorIcon, WarningIcon } from '@phosphor-icons/react'
import type { HdmiStatus } from '../../../shared/ipc'
import { canvasLabel, type Canvas } from '../../../shared/canvas'
import type { ProgramState } from '../../../shared/program'
import { pickDisplay, type DisplayInfo } from '../../../shared/displays'
import type { AudioSettings, HdmiSettings } from '../../../shared/settings'
import { hdmiBadge, needsCanvasConfirm } from '../model'
import { HdmiSection } from './HdmiSection'
import { CanvasSetting } from './CanvasPicker'

/**
 * Header output status (HDMI: green only while its window shows on the second
 * display), the canvas now in force, and the output settings popover (HDMI,
 * audio and the machine's default canvas).
 */
export function OutputMenu({ program }: { program: ProgramState }): React.JSX.Element {
  const api = window.api
  const [hdmi, setHdmi] = useState<HdmiSettings | null>(null)
  const [audio, setAudio] = useState<AudioSettings | null>(null)
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [status, setStatus] = useState<HdmiStatus | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const offs = [
      api.onHdmiStatus(setStatus),
      api.onDisplaysChanged(setDisplays),
      api.onAudioSettings(setAudio)
    ]
    api.getSettings().then((s) => {
      setHdmi(s.hdmi)
      setAudio((cur) => cur ?? s.audio)
      setCanvas(s.canvas)
    })
    // A status pushed before this resolves is newer; keep it.
    api.getHdmiStatus().then((s) => setStatus((cur) => cur ?? s))
    api.listDisplays().then(setDisplays)
    return () => offs.forEach((off) => off())
  }, [api])

  // Main may re-save the HDMI display id (a re-plugged screen got a new id).
  useEffect(() => {
    if (!open) return
    api.getSettings().then((s) => {
      setHdmi(s.hdmi)
      setCanvas(s.canvas)
    })
    api.listDisplays().then(setDisplays)
  }, [api, open])

  useEffect(() => {
    if (!open) return
    wrap.current?.querySelector<HTMLElement>('[role=switch]')?.focus()
    const onClick = (e: MouseEvent): void => {
      // A button that removed itself (the canvas confirm) is not an outside click.
      if (!(e.target as Node).isConnected) return
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    addEventListener('click', onClick)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('click', onClick)
      removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!hdmi || !audio) {
    return (
      <div className="output-menu">
        <span className="output-btn" data-tone="off">
          <MonitorIcon size={16} />
          <span>HDMI</span>
        </span>
      </div>
    )
  }

  const badge = hdmiBadge(status, hdmi)
  // The screen the output window is on: shown only while it really is showing.
  const target = badge.tone === 'ok' ? displays.find((d) => d.id === hdmi.displayId) : undefined
  const StatusIcon = badge.tone === 'warn' || badge.tone === 'error' ? WarningIcon : MonitorIcon

  return (
    <div className="output-menu" ref={wrap}>
      <button
        ref={trigger}
        className="output-btn"
        data-testid="output-status"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="ind" data-testid="hdmi-status" data-tone={badge.tone}>
          <StatusIcon size={16} />
          <span>{badge.text}</span>
        </span>
        <span
          className="canvas-tag"
          data-testid="canvas-badge"
          title={`Canvas ${canvasLabel(program.canvas)}`}
        >
          {canvasLabel(program.canvas)}
        </span>
        {target && (
          <span className="res" title={`${target.label}, ${target.width}x${target.height}`}>
            {target.label}, {target.width}x{target.height}
          </span>
        )}
      </button>
      {open && (
        <div
          className="popover"
          role="dialog"
          aria-label="Output settings"
          data-no-shortcuts
          data-testid="output-popover"
        >
          <HdmiSection
            hdmi={hdmi}
            audio={audio}
            displays={displays}
            status={status}
            onSaved={(s) => {
              setHdmi(s.hdmi)
              setAudio(s.audio)
              setCanvas(s.canvas)
            }}
          />
          {canvas && (
            <section
              className="pop-section canvas-section"
              aria-labelledby="canvas-title"
              data-testid="canvas-section"
            >
              <div className="pop-head">
                <h2 className="pop-title" id="canvas-title">
                  Canvas
                </h2>
              </div>
              <span className="hint">
                Output size for every event without its own canvas. Choose one for an event in the
                Event menu.
              </span>
              <CanvasSetting
                value={canvas}
                allowDefault={false}
                hdmiDisplay={pickDisplay(displays, hdmi.displayId)}
                confirm={needsCanvasConfirm(program)}
                apply={async (c) => {
                  // allowDefault is false: the picker never hands over null here.
                  if (c) setCanvas((await api.setDefaultCanvas(c)).canvas)
                }}
              />
            </section>
          )}
        </div>
      )}
    </div>
  )
}
