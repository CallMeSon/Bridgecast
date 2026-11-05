import { useEffect, useRef, useState } from 'react'
import { XIcon } from '@phosphor-icons/react'
import { BrandMark } from './BrandMark'
import { AppearanceSection } from './AppearanceSection'
import { SoundSection } from './SoundSection'
import { ImportFormat } from './ImportFormat'
import type { AudioSettings, PptImportFormat } from '../../../shared/settings'
import type { AccentId, Theme, ThemePref } from '../appearance'

interface Props {
  open: boolean
  onClose(): void
  theme: Theme
  themePref: ThemePref
  onThemePref(p: ThemePref): void
  accent: AccentId
  onAccent(a: AccentId): void
  customHex: string
  onCustomHex(hex: string): void
  reduceMotion: boolean
  onReduceMotion(on: boolean): void
  audio: AudioSettings | null
  onAudioSaved(a: AudioSettings): void
  /** Only given on Linux (LibreOffice engine). */
  importFormat?: { value: PptImportFormat; onChange(v: PptImportFormat): void }
}

// Roving-tabindex radios (tabindex -1) are not tab stops, so they are not trap ends.
const FOCUSABLE = [
  'button:not(:disabled):not([tabindex="-1"])',
  'input:not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

/** About: mark, name, version and tagline. */
function AboutSection(): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.api
      .getAppVersion()
      .then(setVersion)
      .catch(() => setVersion(''))
  }, [])
  return (
    <section className="set-section about" aria-labelledby="set-about">
      <h3 id="set-about">About</h3>
      <div className="about-brand">
        <BrandMark size={48} />
        <div>
          <p className="about-name">Bridgecast</p>
          {version && <p className="about-line num">{version}</p>}
          <p className="about-line">From slide to screen, live.</p>
        </div>
      </div>
    </section>
  )
}

export function SettingsDialog(p: Props): React.JSX.Element | null {
  const { open, onClose } = p
  const box = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)

  // Focus the close button on open; hand focus back to the opener (the gear) on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    close.current?.focus()
    return () => opener?.focus()
  }, [open])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const at = document.activeElement
    const outside = !box.current?.contains(at)
    if (e.shiftKey && (at === first || outside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (at === last || outside)) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-no-shortcuts
        data-testid="settings-dialog"
        onKeyDown={onKeyDown}
      >
        <div className="set-head">
          <h2 id="settings-title">Settings</h2>
          <button ref={close} className="btn sm" onClick={onClose} data-testid="settings-close">
            <XIcon size={14} />
            Close
          </button>
        </div>
        <div className="set-body">
          <AppearanceSection {...p} />
          {p.importFormat && (
            <section
              className="set-section"
              aria-labelledby="set-import"
              data-testid="settings-import"
            >
              <h3 id="set-import">Import</h3>
              <ImportFormat value={p.importFormat.value} onChange={p.importFormat.onChange} />
            </section>
          )}
          <SoundSection audio={p.audio} onSaved={p.onAudioSaved} />
          <AboutSection />
        </div>
      </div>
    </div>
  )
}
