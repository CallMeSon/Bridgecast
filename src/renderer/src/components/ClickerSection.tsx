import { useEffect, useState } from 'react'
import { clickerNote, type ClickerStatus } from '../../../shared/clicker'
import { errorMessage } from '../model'
import { Switch } from './Switch'

/**
 * Settings > Clicker: PageUp/PageDown and the arrows step the Program even while another app is
 * in front. On by default; applies at once.
 */
export function ClickerSection(): React.JSX.Element | null {
  const [status, setStatus] = useState<ClickerStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    window.api
      .clickerStatus()
      .then((s) => live && setStatus(s))
      .catch((e: unknown) => live && setError(errorMessage(e)))
    const off = window.api.onClickerStatus((s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])

  if (!status) return null
  const note = clickerNote(status)

  return (
    <section className="set-section" aria-labelledby="set-clicker" data-testid="settings-clicker">
      <div className="set-row">
        <div>
          <h3 id="set-clicker">Clicker works when Bridgecast is in the background</h3>
          <p className="hint">
            While on, PageUp, PageDown and the Left and Right arrows go to Bridgecast instead of
            other apps.
          </p>
        </div>
        <Switch
          id="global-clicker"
          labelledBy="set-clicker"
          checked={status.enabled}
          onChange={(on) => {
            setError(null)
            window.api.setClicker(on).then(setStatus, (e: unknown) => setError(errorMessage(e)))
          }}
          testId="settings-global-clicker"
        />
      </div>
      {note && (
        <p className="hint" role="status" data-testid="settings-clicker-note">
          {note}
        </p>
      )}
      {error && (
        <p className="hint" role="alert" data-testid="settings-clicker-error">
          {error}
        </p>
      )}
    </section>
  )
}
