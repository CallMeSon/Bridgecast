import { useState } from 'react'
import type { AudioSettings } from '../../../shared/settings'
import type { AudioRoute } from '../../../shared/omt'
import { errorMessage } from '../model'
import { AudioDevicePicker } from './AudioDevicePicker'
import { Segmented } from './Segmented'

const ROUTES: readonly { value: AudioRoute; label: string }[] = [
  { value: 'local', label: 'Local device' },
  { value: 'omt', label: 'Network' },
  { value: 'both', label: 'Both' }
]

interface Props {
  audio: AudioSettings | null
  onSaved(a: AudioSettings): void
}

/** Settings > Sound: where the output sound goes. Same state as Controls > Output. */
export function SoundSection({ audio, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (patch: Partial<AudioSettings>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSaved((await window.api.patchAudio(patch)).audio)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="set-section" aria-labelledby="set-sound" data-testid="settings-sound">
      <h3 id="set-sound">Sound</h3>
      {!audio ? (
        <p className="hint" role="status">
          Loading sound settings.
        </p>
      ) : (
        <>
          <AudioDevicePicker
            id="set-audio-device"
            testId="settings-audio-device"
            missingTestId="settings-audio-missing"
            deviceId={audio.deviceId}
            disabled={busy}
            onChange={(deviceId) => void save({ deviceId })}
          />
          <div className="field">
            <span className="row-label">Sound to</span>
            <Segmented<AudioRoute>
              label="Sound to"
              value={audio.route}
              options={ROUTES}
              disabled={busy}
              testId="settings-audio-route"
              onChange={(route) => void save({ route })}
            />
            <span className="hint">
              Local device is the HDMI output (or this PC when HDMI is off). Network sends it to OMT
              and NDI receivers.
            </span>
          </div>
          <p className="hint">
            Exactly one window plays sound on this PC: the HDMI output while it shows, otherwise the
            network output.
          </p>
          {error && (
            <p className="pop-error" role="alert" data-testid="settings-audio-error">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}
