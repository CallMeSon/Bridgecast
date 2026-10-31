import { useEffect, useRef, useState } from 'react'
import type { AudioSettings, Settings } from '../../../shared/settings'
import { errorMessage } from '../model'
import type { AudioRoute } from '../../../shared/omt'
import { pickSink, useAudioOutputs } from '../audio'
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
  // The volume the slider shows is always the one saved with any other audio change.
  const volumeRef = useRef(volume)
  // Saves still on their way: their answers must not pull the slider back.
  const inFlight = useRef(0)
  const outputs = useAudioOutputs()
  // Until the list arrives the saved device is assumed present (no false warning).
  const audioMissing = outputs !== null && pickSink(audio.deviceId, outputs).missing

  const saveAudio = async (next: AudioSettings): Promise<void> => {
    setBusy(true)
    setError(null)
    inFlight.current++
    try {
      onSaved(await window.api.setAudio(next))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      inFlight.current--
      setBusy(inFlight.current > 0)
    }
  }

  const volumeSave = useDebouncedSave<number>(
    (masterVolume) =>
      // Only the volume changes here; the rest is whatever is saved now.
      void saveAudio({ ...audio, masterVolume })
  )

  // The saved volume changed elsewhere (a reload of the settings): follow it, unless
  // the operator is mid-change.
  useEffect(() => {
    if (volumeSave.pending() || inFlight.current > 0) return
    volumeRef.current = audio.masterVolume
    setVolume(audio.masterVolume)
  }, [audio.masterVolume, volumeSave])

  return (
    <section className="pop-section" aria-labelledby="audio-title" data-testid="audio-section">
      <div className="pop-head">
        <h3 className="pop-title" id="audio-title">
          Audio
        </h3>
      </div>

      <div className="field">
        <label htmlFor="audio-device">Audio device</label>
        <select
          id="audio-device"
          className="text-input"
          data-testid="audio-device"
          value={audio.deviceId ?? ''}
          disabled={busy}
          onChange={(e) =>
            void saveAudio({
              ...audio,
              masterVolume: volumeRef.current,
              deviceId: e.target.value || null
            })
          }
        >
          <option value="">Default (Windows)</option>
          {(outputs ?? []).map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Audio device ${i + 1}`}
            </option>
          ))}
          {audioMissing && (
            <option value={audio.deviceId ?? ''} disabled>
              Saved device (not connected)
            </option>
          )}
        </select>
        {audioMissing && (
          <p className="pop-status warn" role="status" data-testid="audio-missing">
            The saved audio device is not connected. Sound plays on the Windows default device.
          </p>
        )}
        <span className="hint">Sound of video slides plays on the HDMI output only.</span>
      </div>

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
          onChange={(route) => void saveAudio({ ...audio, masterVolume: volumeRef.current, route })}
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
          volumeRef.current = v
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
          onChange={(muted) => void saveAudio({ ...audio, masterVolume: volumeRef.current, muted })}
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
