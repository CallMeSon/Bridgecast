import { pickDisplay } from '../../../shared/displays'
import { hasConnections } from '../../../shared/omt'
import type { ProgramState } from '../../../shared/program'
import { needsCanvasConfirm } from '../model'
import type { SectionId } from '../panel-sections'
import { AudioSection } from './AudioSection'
import { CanvasSetting } from './CanvasPicker'
import { HdmiSection } from './HdmiSection'
import { NdiSection } from './NdiSection'
import { NetworkSection } from './NetworkSection'
import { OmtSection } from './OmtSection'
import { PanelSection } from './PanelSection'
import type { OutputSettingsState } from './useOutputSettings'

interface Props {
  out: OutputSettingsState
  program: ProgramState
  isOpen(id: SectionId): boolean
  onToggle(id: SectionId, open: boolean): void
}

/**
 * The "Output" (HDMI, audio, machine canvas) and "Network" (frame rate, OMT, NDI) sections
 * of the Output tab. The controls are the ones the header popover used to hold; every
 * change still applies at once and the frame-rate and sender restart warnings are kept.
 */
export function OutputStatus({ out, program, isOpen, onToggle }: Props): React.JSX.Element {
  const api = window.api
  const { hdmi, audio, canvas, omt, ndi, sendContentOnly } = out
  if (!hdmi || !audio || !omt || !ndi || sendContentOnly === null) {
    return (
      <div data-testid="output-panel">
        <PanelSection
          title="Output"
          open={isOpen('output')}
          onToggle={(o) => onToggle('output', o)}
        >
          <p className="note">Loading output settings.</p>
        </PanelSection>
      </div>
    )
  }
  return (
    <div data-testid="output-panel">
      <PanelSection
        title="Output"
        open={isOpen('output')}
        onToggle={(o) => onToggle('output', o)}
        testId="output-section"
        summary={`${hdmi.enabled ? 'HDMI on' : 'HDMI off'}${canvas ? ` · ${canvas.width}×${canvas.height}` : ''}`}
      >
        <HdmiSection
          hdmi={hdmi}
          displays={out.displays}
          status={out.status}
          onSaved={(s) => {
            out.setHdmi(s.hdmi)
            out.setAudio(s.audio)
            out.setCanvas(s.canvas)
          }}
        />
        <AudioSection audio={audio} onSaved={(s) => out.setAudio(s.audio)} />
        {canvas && (
          <section
            className="pop-section canvas-section"
            aria-labelledby="canvas-title"
            data-testid="canvas-section"
          >
            <div className="pop-head">
              <h3 className="pop-title" id="canvas-title">
                Canvas
              </h3>
            </div>
            <span className="hint">
              Default size for events without their own. Set one for this event under Deck settings.
            </span>
            <CanvasSetting
              value={canvas}
              allowDefault={false}
              hdmiDisplay={pickDisplay(out.displays, hdmi.displayId)}
              confirm={needsCanvasConfirm(program)}
              networkReceivers={hasConnections(out.omtStatus, out.ndiStatus)}
              apply={async (c) => {
                // allowDefault is false: the picker never hands over null here.
                if (c) out.setCanvas((await api.setDefaultCanvas(c)).canvas)
              }}
            />
          </section>
        )}
      </PanelSection>
      <PanelSection
        title="Network"
        open={isOpen('network')}
        onToggle={(o) => onToggle('network', o)}
        testId="network-panel"
        summary={`${omt.fps} fps · ${
          [omt.enabled && 'OMT', ndi.enabled && 'NDI'].filter(Boolean).join(' + ') || 'off'
        }`}
      >
        <NetworkSection
          fps={omt.fps}
          sendContentOnly={sendContentOnly}
          omtStatus={out.omtStatus}
          ndiStatus={out.ndiStatus}
          onSaved={(s) => {
            out.setOmt(s.omt)
            out.setNdi(s.ndi)
            out.setSendContentOnly(s.sendContentOnly)
          }}
        />
        <OmtSection
          omt={omt}
          status={out.omtStatus}
          onSaved={(s) => {
            out.setOmt(s.omt)
            out.setAudio(s.audio)
            out.setCanvas(s.canvas)
          }}
        />
        <NdiSection
          ndi={ndi}
          status={out.ndiStatus}
          onSaved={(s) => {
            out.setNdi(s.ndi)
            out.setAudio(s.audio)
            out.setCanvas(s.canvas)
          }}
        />
      </PanelSection>
    </div>
  )
}
