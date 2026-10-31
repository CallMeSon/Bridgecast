import { useEffect, useRef, useState } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import type { Settings } from '../../../shared/settings'
import { NETWORK_CHANGE_CONFIRM, hasConnections, type NetStatus } from '../../../shared/omt'
import { errorMessage } from '../model'
import { Segmented } from './Segmented'

interface Props {
  fps: 30 | 60
  omtStatus: NetStatus | null
  ndiStatus: NetStatus | null
  onSaved(s: Settings): void
}

const FPS = [
  { value: 30, label: '30' },
  { value: 60, label: '60' }
] as const

/**
 * "Network" part of the output popover: settings every network output (OMT, NDI)
 * shares. Today that is the frame rate. Changing it restarts the streams, so with
 * receivers connected on any of them it asks first.
 */
export function NetworkSection({ fps, omtStatus, ndiStatus, onSaved }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingFps, setPendingFps] = useState<30 | 60 | null>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const fpsBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingFps !== null) cancel.current?.focus()
  }, [pendingFps])

  const focusChosen = (): void => {
    // The group was inert while asking: focus returns to the chosen rate.
    requestAnimationFrame(() =>
      fpsBox.current?.querySelector<HTMLElement>('[role=radio][aria-checked=true]')?.focus()
    )
  }

  const save = async (next: 30 | 60): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onSaved(await window.api.setNetworkFps(next))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const chooseFps = (next: 30 | 60): void => {
    if (next === fps) return
    if (hasConnections(omtStatus, ndiStatus)) setPendingFps(next)
    else void save(next)
  }
  const dismiss = (): void => {
    setPendingFps(null)
    focusChosen()
  }

  return (
    <section className="pop-section" aria-labelledby="network-title" data-testid="network-section">
      <div className="pop-head">
        <h3 className="pop-title" id="network-title">
          Network
        </h3>
      </div>

      <div className="field" ref={fpsBox}>
        <span className="row-label" id="network-fps-title">
          Frame rate
        </span>
        {/* inert while asking: the question is the only thing to answer. */}
        <div inert={pendingFps !== null}>
          <Segmented
            label="Frame rate"
            value={fps}
            options={FPS}
            disabled={busy}
            testId="network-fps"
            onChange={chooseFps}
          />
        </div>
        <span className="hint">Frames per second, for OMT and NDI. Use 30 if 60 drops frames.</span>
      </div>
      {pendingFps !== null && (
        <div
          className="canvas-confirm"
          role="group"
          aria-label="Confirm frame rate change"
          data-no-shortcuts
          data-testid="network-confirm"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            dismiss()
          }}
        >
          <WarningCircleIcon className="ph" size={20} />
          <p>
            <strong>{NETWORK_CHANGE_CONFIRM}</strong>
            <span>
              New frame rate: <span className="num">{pendingFps}</span>
            </span>
          </p>
          <span className="actions">
            <button
              className="btn sm danger"
              data-testid="network-confirm-yes"
              onClick={() => {
                const next = pendingFps
                setPendingFps(null)
                void save(next).then(focusChosen)
              }}
            >
              Change frame rate
            </button>
            <button ref={cancel} className="btn sm" onClick={dismiss}>
              Cancel
            </button>
          </span>
        </div>
      )}

      {error && (
        <p className="pop-error" role="alert" data-testid="network-error">
          {error}
        </p>
      )}
    </section>
  )
}
