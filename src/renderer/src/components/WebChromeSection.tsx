import { useEffect, useState } from 'react'
import type { WebChromeStatus } from '../../../shared/web'
import { errorMessage } from '../model'
import { Switch } from './Switch'

/**
 * Settings > Web pages (Linux only): host web decks in the PC's own Chrome, and sign in to Google
 * once in a Chrome window that is not automated. Off by default. The choice is read at start, so
 * a change waits for a restart and never touches a page on air.
 */
export function WebChromeSection(): React.JSX.Element | null {
  const [status, setStatus] = useState<WebChromeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    window.api
      .webChromeStatus()
      .then((s) => live && setStatus(s))
      .catch((e: unknown) => live && setError(errorMessage(e)))
    const off = window.api.onWebChromeStatus((s) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])

  if (!status?.supported) return null

  const run = async (act: () => Promise<WebChromeStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await act())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const usable = status.enabled && !status.problem && status.browser !== null

  return (
    <section className="set-section" aria-labelledby="set-chrome" data-testid="settings-chrome">
      <div className="set-row">
        <div>
          <h3 id="set-chrome">Use Chrome for web pages</h3>
          <p className="hint">
            Runs web decks in Google Chrome on this PC, so sites that refuse embedded browsers and
            Sign in with Google work. Off uses the built-in browser.
          </p>
        </div>
        <Switch
          id="web-chrome"
          labelledBy="set-chrome"
          checked={status.enabled}
          disabled={busy}
          onChange={(on) => void run(() => window.api.setWebChrome(on))}
          testId="settings-web-chrome"
        />
      </div>
      {status.enabled && status.problem && (
        <p className="hint" role="status" data-testid="settings-chrome-problem">
          {status.problem}
        </p>
      )}
      {status.restartNeeded && (
        <p className="hint" role="status" data-testid="settings-chrome-restart">
          Applies the next time Bridgecast starts. Web pages on air are not changed.
        </p>
      )}
      {usable && (
        <div className="set-row">
          <div>
            <span className="row-label">Google account</span>
            <p className="hint">
              Opens {status.browser} with Bridgecast&apos;s own profile. Your personal Chrome
              profile is never used. Close the window when you are done; web pages then reuse the
              sign-in.
            </p>
          </div>
          <button
            className="btn sm"
            disabled={busy || status.signInOpen}
            onClick={() => void run(() => window.api.signInGoogle())}
            data-testid="settings-chrome-signin"
          >
            {status.signInOpen ? 'Window open' : 'Sign in to Google'}
          </button>
        </div>
      )}
      {error && (
        <p className="hint" role="alert" data-testid="settings-chrome-error">
          {error}
        </p>
      )}
    </section>
  )
}
