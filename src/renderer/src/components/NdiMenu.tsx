import { useEffect, useRef, useState } from 'react'
import type { NdiStatus } from '../../../shared/ipc'
import {
  FPS_OPTIONS,
  NAME_MAX,
  RESOLUTIONS,
  ndiSettingsError,
  type NdiSettings
} from '../../../shared/settings'
import { errorMessage, ndiBadge } from '../model'

const same = (a: NdiSettings, b: NdiSettings): boolean =>
  a.enabled === b.enabled &&
  a.name.trim() === b.name.trim() &&
  a.width === b.width &&
  a.height === b.height &&
  a.fps === b.fps

/** Header NDI status (green dot only while sending) + settings popover. */
export function NdiMenu(): React.JSX.Element {
  const api = window.api
  const [settings, setSettings] = useState<NdiSettings | null>(null)
  const [status, setStatus] = useState<NdiStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<NdiSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const off = api.onNdiStatus(setStatus)
    api.getSettings().then(
      (s) => setSettings(s.ndi),
      (e) => setError(errorMessage(e))
    )
    // A status pushed before this resolves is newer; keep it.
    api.getNdiStatus().then((s) => setStatus((cur) => cur ?? s))
    return off
  }, [api])

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const onClick = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    addEventListener('click', onClick)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('click', onClick)
      removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!settings) {
    return (
      <div className="status">
        <span className="dot off" />
        <span>NDI</span>
      </div>
    )
  }

  const badge = ndiBadge(status, settings)
  const toggle = (): void => {
    if (!open) {
      setDraft(settings)
      setError(null)
    }
    setOpen(!open)
  }
  const edit = (patch: Partial<NdiSettings>): void => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setError(null)
  }
  const apply = async (): Promise<void> => {
    if (!draft) return
    const invalid = ndiSettingsError(draft)
    if (invalid) {
      setError(invalid)
      return
    }
    setApplying(true)
    try {
      const saved = await api.setSettings({ ndi: { ...draft, name: draft.name.trim() } })
      setSettings(saved.ndi)
      setDraft(saved.ndi)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setApplying(false)
    }
  }

  const d = draft ?? settings
  // "STUDIO-PC (PPT Share)" → "STUDIO-PC": NDI always prefixes the computer name.
  const host = status?.source?.replace(/ \(.*\)$/, '') || 'NAMA-KOMPUTER'
  const dirty = !same(d, settings)
  const retry = settings.enabled && status?.state === 'error'

  return (
    <div className="ndi" ref={wrap}>
      <button
        ref={trigger}
        className="status ndi-btn"
        data-testid="ndi-status"
        data-tone={badge.tone}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={`dot ${badge.tone}`} />
        <span>
          NDI {badge.name && <b>{badge.name}</b>}
          {badge.name ? ' · ' : ''}
          {badge.detail}
        </span>
      </button>
      {open && (
        <div
          className="popover"
          role="dialog"
          aria-label="Pengaturan NDI"
          data-no-shortcuts
          data-testid="ndi-popover"
        >
          <div className="pop-head">
            <span className="pop-title">Output NDI</span>
            <button
              ref={first}
              className="switch"
              role="switch"
              aria-checked={d.enabled}
              aria-label="Output NDI aktif"
              onClick={() => edit({ enabled: !d.enabled })}
            >
              <span className="knob" />
            </button>
            <span className="switch-label">{d.enabled ? 'Aktif' : 'Nonaktif'}</span>
          </div>

          <StatusLine status={status} settings={settings} />

          <div className="field">
            <label htmlFor="ndi-name">Nama source</label>
            <input
              id="ndi-name"
              className="text-input"
              value={d.name}
              maxLength={NAME_MAX}
              spellCheck={false}
              onChange={(e) => edit({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void apply()
              }}
            />
            <span className="hint">
              Di vMix dan Resolume muncul sebagai {host} ({d.name.trim() || '…'}).
            </span>
          </div>

          <div className="field">
            <span className="label" id="ndi-res">
              Resolusi
            </span>
            <div className="seg full" role="radiogroup" aria-labelledby="ndi-res">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.width}
                  role="radio"
                  aria-checked={d.width === r.width && d.height === r.height}
                  onClick={() => edit({ width: r.width, height: r.height })}
                >
                  {r.width}×{r.height}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label" id="ndi-fps">
              Frame rate
            </span>
            <div className="seg full" role="radiogroup" aria-labelledby="ndi-fps">
              {FPS_OPTIONS.map((f) => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={d.fps === f}
                  onClick={() => edit({ fps: f })}
                >
                  {f} fps
                </button>
              ))}
            </div>
            {(d.width > 1920 || d.fps > 30) && (
              <span className="hint">
                Resolusi atau frame rate tinggi memakai lebih banyak CPU dan jaringan.
              </span>
            )}
          </div>

          {error && (
            <p className="pop-error" role="alert">
              {error}
            </p>
          )}

          <div className="pop-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Tutup
            </button>
            <button
              className="btn accent"
              disabled={applying || (!dirty && !retry)}
              onClick={() => void apply()}
            >
              {applying ? 'Menerapkan…' : retry && !dirty ? 'Coba lagi' : 'Terapkan'}
            </button>
          </div>
          <p className="fine">NDI® adalah merek dagang terdaftar milik Vizrt NDI AB.</p>
        </div>
      )}
    </div>
  )
}

function StatusLine({
  status,
  settings
}: {
  status: NdiStatus | null
  settings: NdiSettings
}): React.JSX.Element {
  if (!settings.enabled) {
    return <p className="pop-status">NDI nonaktif. vMix dan Resolume tidak menerima gambar.</p>
  }
  if (status?.state === 'error') {
    return (
      <p className="pop-status error" role="alert" data-testid="ndi-error">
        {status.message}
      </p>
    )
  }
  if (status?.state === 'running') {
    return (
      <p className="pop-status ok">
        Mengirim sebagai <b>{status.source}</b>
      </p>
    )
  }
  return <p className="pop-status">Memulai output NDI…</p>
}
