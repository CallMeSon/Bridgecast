import { pickSink, useAudioOutputs } from '../audio'

interface Props {
  id: string
  testId: string
  missingTestId: string
  deviceId: string | null
  disabled?: boolean
  onChange(deviceId: string | null): void
}

/** Output device `<select>` with the "saved device not connected" warning and hint. */
export function AudioDevicePicker({
  id,
  testId,
  missingTestId,
  deviceId,
  disabled,
  onChange
}: Props): React.JSX.Element {
  const outputs = useAudioOutputs()
  // Until the list arrives the saved device is assumed present (no false warning).
  const missing = outputs !== null && pickSink(deviceId, outputs).missing
  return (
    <div className="field">
      <label htmlFor={id}>Audio device</label>
      <select
        id={id}
        className="text-input"
        data-testid={testId}
        value={deviceId ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Default (Windows)</option>
        {(outputs ?? []).map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Audio device ${i + 1}`}
          </option>
        ))}
        {missing && (
          <option value={deviceId ?? ''} disabled>
            Saved device (not connected)
          </option>
        )}
      </select>
      {missing && (
        <p className="pop-status warn" role="status" data-testid={missingTestId}>
          The saved audio device is not connected. Sound plays on the Windows default device.
        </p>
      )}
      <span className="hint">Sound of video slides plays on the HDMI output only.</span>
    </div>
  )
}
