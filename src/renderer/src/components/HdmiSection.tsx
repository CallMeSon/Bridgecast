import { useState } from 'react'
import type { HdmiStatus } from '../../../shared/ipc'
import type { HdmiSettings, Settings } from '../../../shared/settings'
import {
  NO_SECOND_DISPLAY,
  displayText,
  pickDisplay,
  type DisplayInfo
} from '../../../shared/displays'
import { errorMessage, hdmiBadge, hdmiStatusText } from '../model'

interface Props {
  hdmi: HdmiSettings
  displays: DisplayInfo[]
  status: HdmiStatus | null
  onSaved(s: Settings): void
}

/**
 * "Output HDMI" part of the output popover: on/off and the target display.
 * Unlike NDI (Terapkan), every change is applied at once — like Win+P.
 * Main validates the display again against the screens connected right now.
 */
export function HdmiSection({ hdmi, displays, status, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasSecond = displays.some((d) => !d.primary)
  // Turning on is impossible with one screen; turning off always works.
  const blocked = !hdmi.enabled && !hasSecond
  const selected = hdmi.displayId ?? pickDisplay(displays, null)?.id ?? null
  const savedMissing = hdmi.displayId !== null && !displays.some((d) => d.id === hdmi.displayId)
  const tone = hdmiBadge(status, hdmi).tone

  const save = async (next: HdmiSettings): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await window.api.setHdmi(next))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pop-section" aria-labelledby="hdmi-title" data-testid="hdmi-section">
      <div className="pop-head">
        <span className="pop-title" id="hdmi-title">
          Output HDMI
        </span>
        <button
          className="switch"
          role="switch"
          aria-checked={hdmi.enabled}
          aria-label="Output HDMI aktif"
          aria-disabled={blocked || busy}
          aria-describedby="hdmi-message"
          data-testid="hdmi-switch"
          onClick={() => {
            if (blocked || busy) return
            void save({ enabled: !hdmi.enabled, displayId: selected })
          }}
        >
          <span className="knob" />
        </button>
        <span className="switch-label">{hdmi.enabled ? 'Aktif' : 'Nonaktif'}</span>
      </div>

      <p
        id="hdmi-message"
        className={`pop-status ${blocked ? 'warn' : tone}`}
        role="status"
        data-testid="hdmi-message"
      >
        {blocked ? NO_SECOND_DISPLAY : hdmiStatusText(status, hdmi)}
      </p>

      <div className="field">
        <label htmlFor="hdmi-display">Layar tujuan</label>
        <select
          id="hdmi-display"
          className="text-input"
          value={selected === null ? '' : String(selected)}
          disabled={busy || !hasSecond}
          onChange={(e) => void save({ enabled: hdmi.enabled, displayId: Number(e.target.value) })}
        >
          {selected === null && <option value="">Tidak ada layar kedua</option>}
          {displays.map((d) => (
            <option key={d.id} value={String(d.id)} disabled={d.primary}>
              {displayText(d)}
            </option>
          ))}
          {savedMissing && (
            <option value={String(hdmi.displayId)} disabled>
              Layar tersimpan (tidak tersambung)
            </option>
          )}
        </select>
        <span className="hint">
          Program tampil layar penuh di layar ini. Perubahan HDMI langsung diterapkan.
        </span>
      </div>

      {error && (
        <p className="pop-error" role="alert" data-testid="hdmi-error">
          {error}
        </p>
      )}
    </section>
  )
}
