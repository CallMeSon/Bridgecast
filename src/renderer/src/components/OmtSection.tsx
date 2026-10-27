import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { Settings } from '../../../shared/settings'
import {
  OMT_DROPS,
  OMT_NO_RECEIVERS,
  OMT_NO_SOUND,
  OMT_RECEIVERS_CONFIRM,
  OMT_START_FAILED,
  omtBadge,
  type OmtSettings,
  type OmtStatus
} from '../../../shared/omt'
import { errorMessage } from '../model'
import { useNoReceiversHint } from '../omt'
import { Segmented } from './Segmented'
import { Switch } from './Switch'

interface Props {
  omt: OmtSettings
  status: OmtStatus | null
  onSaved(s: Settings): void
}

const FPS = [
  { value: 30, label: '30' },
  { value: 60, label: '60' }
] as const

function statusText(omt: OmtSettings, s: OmtStatus | null): string {
  if (!omt.enabled || !s || s.state === 'off') return 'Off'
  if (s.state === 'error') return s.message ?? OMT_START_FAILED
  if (s.state === 'starting') return 'Starting OMT output…'
  return s.connections > 0 ? `Live. ${omtBadge(s).text.slice(6)}` : 'Live, waiting for a receiver'
}

/**
 * "OMT output" part of the output popover: on/off, the source name receivers list,
 * the frame rate, the Source string to copy, and the status with its warnings.
 * Changes apply at once; the name is saved on Enter or when the field loses focus.
 * Changing the frame rate restarts the stream, so with receivers connected it asks first.
 */
export function OmtSection({ omt, status, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(omt.name)
  const [savedName, setSavedName] = useState(omt.name)
  const [pendingFps, setPendingFps] = useState<30 | 60 | null>(null)
  const [copied, setCopied] = useState(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const fpsBox = useRef<HTMLDivElement>(null)
  const noReceivers = useNoReceiversHint(status)

  // The saved name changed (sanitized by main, or elsewhere): the field shows it.
  if (savedName !== omt.name) {
    setSavedName(omt.name)
    setName(omt.name)
  }

  useEffect(() => {
    if (pendingFps !== null) cancel.current?.focus()
  }, [pendingFps])
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const save = async (next: OmtSettings): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = await window.api.setOmt(next)
      onSaved(saved)
      // Show what main kept (trimmed, or the default name for an empty one).
      setName(saved.omt.name)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const commitName = (): void => {
    if (name === omt.name) return
    void save({ ...omt, name })
  }

  const receivers = (status?.connections ?? 0) > 0
  const chooseFps = (fps: 30 | 60): void => {
    if (receivers) setPendingFps(fps)
    else void save({ ...omt, fps })
  }
  const dismissFps = (): void => {
    setPendingFps(null)
    // The group was inert while asking: focus returns to the chosen rate.
    requestAnimationFrame(() =>
      fpsBox.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true]')?.focus()
    )
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

  const tone = omtBadge(status).tone
  const running = omt.enabled && status?.state === 'running'
  const warnings = [
    status?.warning === 'drops' && OMT_DROPS,
    (noReceivers || status?.warning === 'no-receivers') && OMT_NO_RECEIVERS,
    status?.warning === 'no-sound' && OMT_NO_SOUND
  ].filter((w): w is string => !!w)

  return (
    <section className="pop-section" aria-labelledby="omt-title" data-testid="omt-section">
      <div className="pop-head">
        <label className="pop-title" id="omt-title" htmlFor="omt-switch">
          OMT output
        </label>
        <Switch
          id="omt-switch"
          labelledBy="omt-title"
          checked={omt.enabled}
          disabled={busy}
          describedBy="omt-message"
          testId="omt-switch"
          onChange={(enabled) => void save({ ...omt, name, enabled })}
        />
      </div>

      <p
        id="omt-message"
        className={`pop-status ${tone === 'error' ? 'error' : ''}`}
        role="status"
        data-testid="omt-message"
      >
        {statusText(omt, status)}
      </p>
      {warnings.map((w) => (
        <p key={w} className="pop-status warn" role="status" data-testid="omt-warning">
          {w}
        </p>
      ))}

      <div className="field">
        <label htmlFor="omt-name">Source name</label>
        <input
          id="omt-name"
          className="text-input"
          data-testid="omt-name"
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

      <div className="field" ref={fpsBox}>
        <span className="row-label" id="omt-fps-title">
          Frame rate
        </span>
        {/* inert while asking: the question is the only thing to answer. */}
        <div inert={pendingFps !== null}>
          <Segmented
            label="Frame rate"
            value={omt.fps}
            options={FPS}
            disabled={busy}
            testId="omt-fps"
            onChange={chooseFps}
          />
        </div>
        <span className="hint">Frames per second. Use 30 if 60 drops frames.</span>
      </div>
      {pendingFps !== null && (
        <div
          className="canvas-confirm"
          role="group"
          aria-label="Confirm frame rate change"
          data-no-shortcuts
          data-testid="omt-confirm"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            dismissFps()
          }}
        >
          <WarningCircleIcon className="ph" size={20} />
          <p>
            <strong>{OMT_RECEIVERS_CONFIRM}</strong>
            <span>
              New frame rate: <span className="num">{pendingFps}</span>
            </span>
          </p>
          <span className="actions">
            <button
              className="btn sm danger"
              data-testid="omt-confirm-yes"
              onClick={() => {
                const fps = pendingFps
                setPendingFps(null)
                void save({ ...omt, name, fps }).then(() =>
                  requestAnimationFrame(() =>
                    fpsBox.current
                      ?.querySelector<HTMLElement>('[role=radio][aria-checked=true]')
                      ?.focus()
                  )
                )
              }}
            >
              Change frame rate
            </button>
            <button ref={cancel} className="btn sm" onClick={dismissFps}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {running && status?.address && (
        <div className="field">
          <span className="row-label" id="omt-source-title">
            Source
          </span>
          <div className="omt-source">
            <span className="num" aria-labelledby="omt-source-title" data-testid="omt-address">
              {status.address}
            </span>
            <button className="btn sm" data-testid="omt-copy" onClick={() => void copy()}>
              <CopyIcon size={16} />
              Copy
            </button>
          </div>
          <span className="hint" role="status" data-testid="omt-copied">
            {copied ? (
              <>
                <CheckIcon size={14} /> Copied
              </>
            ) : (
              'Paste it in a receiver to add PPT Share by hand.'
            )}
          </span>
        </div>
      )}

      {error && (
        <p className="pop-error" role="alert" data-testid="omt-error">
          {error}
        </p>
      )}
    </section>
  )
}
