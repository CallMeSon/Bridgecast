import { useEffect, useRef, useState } from 'react'
import type { AudioSettings, Settings } from '../../../shared/settings'
import { errorMessage } from '../model'
import type { AudioRoute } from '../../../shared/omt'
import { AudioDevicePicker } from './AudioDevicePicker'
import { Segmented } from './Segmented'
import { Switch } from './Switch'
import { VolumeSlider } from './VolumeSlider'
import { useDebouncedSave } from './useDebouncedSave'

const ROUTES: readonly { value: AudioRoute; label: string }[] = [
  { value: 'local', label: 'Local device' },
  { value: 'omt', label: 'Network' },
  { value: 'both', label: 'Both' }
]

interface Props {
  audio: AudioSettings
  onSaved(s: Settings): void
}

/**
 * "Audio" part of the output popover: the sound device, the master volume and
 * Mute all, the settings of every sound on the HDMI output (video slides). Changes
 * apply at once; the master volume previews in the slider and is saved 150 ms
 * after the last change (and when the popover closes).
 */
export function AudioSection({ audio, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [volume, setVolume] = useState(audio.masterVolume)
  // Saves still on their way: their answers must not pull the slider back.
  const inFlight = useRef(0)

  // Each save sends only the field it changes, so it cannot undo another writer's change
  // (the transport mute, the Settings dialog).
  const saveAudio = async (patch: Partial<AudioSettings>): Promise<void> => {
    setBusy(true)
    setError(null)
    inFlight.current++
    try {
      onSaved(await window.api.patchAudio(patch))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      inFlight.current--
      setBusy(inFlight.current > 0)
    }
  }

  const volumeSave = useDebouncedSave<number>((masterVolume) => void saveAudio({ masterVolume }))

  // The saved volume changed elsewhere (a reload of the settings): follow it, unless
  // the operator is mid-change.
  useEffect(() => {
    if (volumeSave.pending() || inFlight.current > 0) return
    setVolume(audio.masterVolume)
  }, [audio.masterVolume, volumeSave])

  return (
    <section className="pop-section" aria-labelledby="audio-title" data-testid="audio-section">
      <div className="pop-head">
        <h3 className="pop-title" id="audio-title">
          Audio
        </h3>
      </div>

      <AudioDevicePicker
        id="audio-device"
        testId="audio-device"
        missingTestId="audio-missing"
        deviceId={audio.deviceId}
        disabled={busy}
        onChange={(deviceId) => void saveAudio({ deviceId })}
      />

      <div className="field">
        <span className="row-label" id="audio-route-title">
          Sound to
        </span>
        <Segmented<AudioRoute>
          label="Sound to"
          value={audio.route}
          options={ROUTES}
          disabled={busy}
          testId="audio-route"
          onChange={(route) => void saveAudio({ route })}
        />
        <span className="hint">
          Local device is the HDMI output (or this PC when HDMI is off). Network sends it to OMT and
          NDI receivers.
        </span>
      </div>

      <VolumeSlider
        id="audio-master"
        label="Master volume"
        value={volume}
        testId="audio-master"
        onChange={(v) => {
          setVolume(v)
          volumeSave.schedule(v)
        }}
      />

      <div className="pop-head">
        <label className="row-label" id="audio-mute-title" htmlFor="audio-mute">
          Mute all
        </label>
        <Switch
          id="audio-mute"
          labelledBy="audio-mute-title"
          checked={audio.muted}
          disabled={busy}
          testId="audio-mute"
          onChange={(muted) => void saveAudio({ muted })}
        />
      </div>

      {error && (
        <p className="pop-error" role="alert" data-testid="audio-error">
          {error}
        </p>
      )}
    </section>
  )
}
