import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import type { Settings } from '../../../shared/settings'
import { NDI_COPY, ndiBadge, type NdiSettings, type NdiStatus } from '../../../shared/omt'
import { errorMessage } from '../model'
import { useNoReceiversHint } from '../omt'
import { Switch } from './Switch'

interface Props {
  ndi: NdiSettings
  status: NdiStatus | null
  onSaved(s: Settings): void
}

function statusText(ndi: NdiSettings, s: NdiStatus | null): string {
  if (!ndi.enabled || !s || s.state === 'off') return 'Off'
  if (s.state === 'error') return s.message ?? NDI_COPY.createFailed
  if (s.state === 'starting') return 'Starting NDI output…'
  return s.connections > 0 ? `Live. ${ndiBadge(s).text.slice(6)}` : 'Live, waiting for a receiver'
}

/**
 * "NDI output" part of the output popover: on/off, the source name receivers list,
 * the Source string to copy, and the status with its warnings.
 * Changes apply at once; the name is saved on Enter or when the field loses focus.
 * The frame rate is shared with NDI and lives in NetworkSection.
 */
export function NdiSection({ ndi, status, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(ndi.name)
  const [savedName, setSavedName] = useState(ndi.name)
  const [copied, setCopied] = useState(false)
  const noReceivers = useNoReceiversHint(status)

  // The saved name changed (sanitized by main, or elsewhere): the field shows it.
  if (savedName !== ndi.name) {
    setSavedName(ndi.name)
    setName(ndi.name)
  }

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const save = async (next: NdiSettings): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = await window.api.setNdi(next)
      onSaved(saved)
      // Show what main kept (trimmed, or the default name for an empty one).
      setName(saved.ndi.name)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const commitName = (): void => {
    if (name === ndi.name) return
    void save({ ...ndi, name })
  }

  const copy = async (): Promise<void> => {
    if (!status?.address) return
    try {
      await navigator.clipboard.writeText(status.address)
      setCopied(true)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const tone = ndiBadge(status).tone
  const running = ndi.enabled && status?.state === 'running'
  const warnings: string[] = [
    (noReceivers || status?.warning === 'no-receivers') && NDI_COPY.noReceivers,
    status?.warning === 'no-sound' && NDI_COPY.noSound
  ].filter((w) => w !== false)

  return (
    <section className="pop-section" aria-labelledby="ndi-title" data-testid="ndi-section">
      <div className="pop-head">
        <label className="pop-title" id="ndi-title" htmlFor="ndi-switch">
          NDI
        </label>
        <Switch
          id="ndi-switch"
          labelledBy="ndi-title"
          checked={ndi.enabled}
          disabled={busy}
          describedBy="ndi-message"
          testId="ndi-switch"
          onChange={(enabled) => void save({ ...ndi, name, enabled })}
        />
      </div>

      <p
        id="ndi-message"
        className={`pop-status ${tone === 'error' ? 'error' : ''}`}
        role="status"
        data-testid="ndi-message"
      >
        {statusText(ndi, status)}
      </p>
      {warnings.map((w) => (
        <p key={w} className="pop-status warn" role="status" data-testid="ndi-warning">
          {w}
        </p>
      ))}

      <div className="field">
        <label htmlFor="ndi-name">Source name</label>
        <input
          id="ndi-name"
          className="text-input"
          data-testid="ndi-name"
          value={name}
          maxLength={64}
          readOnly={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            commitName()
          }}
          onBlur={commitName}
        />
        <span className="hint">The name vMix, OBS and other receivers list.</span>
      </div>

      {running && status?.address && (
        <div className="field">
          <span className="row-label" id="ndi-source-title">
            Source
          </span>
          <div className="omt-source">
            <span className="num" aria-labelledby="ndi-source-title" data-testid="ndi-address">
              {status.address}
            </span>
            <button className="btn sm" data-testid="ndi-copy" onClick={() => void copy()}>
              <CopyIcon size={16} />
              Copy
            </button>
          </div>
          <span className="hint" role="status" data-testid="ndi-copied">
            {copied ? (
              <>
                <CheckIcon size={14} /> Copied
              </>
            ) : (
              'Pick this source in vMix, OBS or another NDI receiver.'
            )}
          </span>
        </div>
      )}

      {error && (
        <p className="pop-error" role="alert" data-testid="ndi-error">
          {error}
        </p>
      )}
    </section>
  )
}
