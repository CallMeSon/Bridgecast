import { useState } from 'react'
import type { HdmiStatus } from '../../../shared/ipc'
import type { HdmiSettings, Settings } from '../../../shared/settings'
import { NO_SECOND_DISPLAY, displayText, type DisplayInfo } from '../../../shared/displays'
import { errorMessage, hdmiBadge, hdmiStatusText } from '../model'
import { Switch } from './Switch'

interface Props {
  hdmi: HdmiSettings
  displays: DisplayInfo[]
  status: HdmiStatus | null
  onSaved(s: Settings): void
}

/**
 * "Output HDMI" part of the output popover: on/off and the target display.
 * Every change is applied at once — like Win+P.
 * Main validates the display again against the screens connected right now.
 */
export function HdmiSection({ hdmi, displays, status, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasSecond = displays.some((d) => !d.primary)
  // Turning on is impossible with one screen; turning off always works.
  const blocked = !hdmi.enabled && !hasSecond
  // Never the primary nor the display holding the operator window (marked "(layar operator)").
  const unusable = (d: DisplayInfo): boolean => d.primary || !!d.operator
  const selected = hdmi.displayId ?? displays.find((d) => !unusable(d))?.id ?? null
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
        <label className="pop-title" id="hdmi-title" htmlFor="hdmi-switch">
          Output HDMI
        </label>
        <Switch
          id="hdmi-switch"
          labelledBy="hdmi-title"
          checked={hdmi.enabled}
          disabled={blocked || busy}
          describedBy="hdmi-message"
          testId="hdmi-switch"
          onChange={() => void save({ enabled: !hdmi.enabled, displayId: selected })}
        />
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
          {selected === null && (
            <option value="">
              {hasSecond ? 'Tidak ada layar yang bisa dipakai' : 'Tidak ada layar kedua'}
            </option>
          )}
          {displays.map((d) => (
            <option key={d.id} value={String(d.id)} disabled={unusable(d)}>
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
