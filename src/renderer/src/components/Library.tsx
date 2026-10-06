import { useRef } from 'react'
import { FileIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { DeckMeta } from '../../../shared/types'
import type { ImportProgress } from '../../../shared/ipc'

interface Props {
  decks: DeckMeta[]
  imports: ImportProgress[]
  currentDeckId: string | null
  canImport: boolean
  onSelectDeck(deckId: string): void
  onDismissImport(id: string): void
  onFiles(files: File[]): void
}

export function Library(p: Props): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const count = p.decks.length

  return (
    <aside className="left">
      <div className="panel-h">
        Library <span className="grow" />
        <span className="count">{count} deck</span>
      </div>
      <div className="decks">
        {count === 0 && p.imports.length === 0 && (
          <div className="empty-lib">Belum ada deck di event ini.</div>
        )}
        {p.decks.map((d) => (
          <button
            key={d.id}
            className="deck"
            aria-current={d.id === p.currentDeckId ? 'true' : undefined}
            onClick={() => p.onSelectDeck(d.id)}
          >
            <FileIcon className="ph" size={18} />
            <span className="name" title={d.name}>
              {d.name}
            </span>
            <span className="meta">{d.slides.length} slide</span>
          </button>
        ))}
        {p.imports.map((x) =>
          x.status === 'error' ? (
            <button
              key={x.id}
              className="deck err"
              title="Klik untuk menutup"
              onClick={() => p.onDismissImport(x.id)}
            >
              <WarningCircleIcon className="ph" size={18} />
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="meta">Gagal</span>
              {x.message && <span className="msg">{x.message}</span>}
            </button>
          ) : (
            <div key={x.id} className="deck busy" aria-busy="true">
              <FileIcon className="ph" size={18} />
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="meta">Mengonversi</span>
              <span className="bar">
                <i style={{ width: `${x.percent}%` }} />
              </span>
            </div>
          )
        )}
      </div>
      <button className="drop" disabled={!p.canImport} onClick={() => input.current?.click()}>
        <UploadSimpleIcon className="ph" size={18} />
        <div>
          <b>Tambah file</b>Seret PPTX atau PDF ke mana saja di jendela ini.
        </div>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pptx,.ppt,.pdf"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) p.onFiles(files)
        }}
      />
    </aside>
  )
}
