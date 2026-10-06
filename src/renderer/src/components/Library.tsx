import { useCallback, useEffect, useRef, useState } from 'react'
import { FileIcon, TrashIcon, UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { DeckMeta } from '../../../shared/types'
import type { ImportProgress } from '../../../shared/ipc'
import { importMeta } from '../model'

/** An import row: main's progress, plus an optional label for the error meta. */
export type ImportRow = ImportProgress & { meta?: string }

const DECK_TYPE = 'application/x-ppt-share-deck'

interface Props {
  decks: DeckMeta[]
  imports: ImportRow[]
  currentDeckId: string | null
  canImport: boolean
  onSelectDeck(deckId: string): void
  onDismissImport(id: string): void
  onFiles(files: File[]): void
  onMoveDeck(from: number, to: number): void
  onRemoveDeck(deckId: string): void
}

interface MenuAt {
  deckId: string
  x: number
  y: number
}

/** Right-click menu of a deck: one item, closes on Escape, outside click, scroll or blur. */
function DeckMenu({
  at,
  onRemove,
  onClose
}: {
  at: MenuAt
  onRemove(): void
  onClose(): void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const close = (e: Event): void => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    addEventListener('pointerdown', close, true)
    addEventListener('keydown', close, true)
    addEventListener('blur', close)
    addEventListener('resize', close)
    return () => {
      removeEventListener('pointerdown', close, true)
      removeEventListener('keydown', close, true)
      removeEventListener('blur', close)
      removeEventListener('resize', close)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      className="menu ctx-menu"
      role="menu"
      data-no-shortcuts
      style={{ left: at.x, top: at.y }}
      data-testid="deck-menu"
    >
      <button role="menuitem" className="danger" onClick={onRemove}>
        <TrashIcon className="chk" size={16} />
        Hapus deck…
      </button>
    </div>
  )
}

/** Inline confirmation in place of the deck row (no modal). */
function ConfirmRemove({
  deck,
  onConfirm,
  onCancel
}: {
  deck: DeckMeta
  onConfirm(): void
  onCancel(): void
}): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => cancel.current?.focus(), [])
  return (
    <div
      className="deck confirm"
      role="group"
      aria-label={`Hapus ${deck.name}`}
      data-no-shortcuts
      data-testid="confirm-remove"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <TrashIcon className="ph" size={18} />
      <span className="name" title={deck.name}>
        Hapus deck ini?
      </span>
      <span className="msg">
        {deck.name} · {deck.slides.length} slide. Tidak bisa dibatalkan.
      </span>
      <span className="actions">
        <button className="btn sm danger" onClick={onConfirm}>
          Hapus
        </button>
        <button ref={cancel} className="btn sm" onClick={onCancel}>
          Batal
        </button>
      </span>
    </div>
  )
}

export function Library(p: Props): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const count = p.decks.length
  const closeMenu = useCallback(() => setMenu(null), [])

  const openMenu = (e: React.MouseEvent<HTMLElement>, deckId: string): void => {
    e.preventDefault()
    let { clientX: x, clientY: y } = e
    if (x === 0 && y === 0) {
      // Keyboard (Shift+F10 / context menu key): anchor to the row.
      const r = e.currentTarget.getBoundingClientRect()
      x = r.left + 24
      y = r.bottom
    }
    setConfirm(null)
    setMenu({ deckId, x, y })
  }

  return (
    <aside className="left">
      <div className="panel-h">
        Library <span className="grow" />
        <span className="count">{count} deck</span>
      </div>
      <div className="decks" data-testid="decks">
        {count === 0 && p.imports.length === 0 && (
          <div className="empty-lib">Belum ada deck di event ini.</div>
        )}
        {p.decks.map((d, i) =>
          confirm === d.id ? (
            <ConfirmRemove
              key={d.id}
              deck={d}
              onConfirm={() => {
                setConfirm(null)
                p.onRemoveDeck(d.id)
              }}
              onCancel={() => setConfirm(null)}
            />
          ) : (
            <button
              key={d.id}
              className={'deck' + (dragging === i ? ' dragging' : '') + (over === i ? ' over' : '')}
              data-deck-id={d.id}
              draggable
              aria-current={d.id === p.currentDeckId ? 'true' : undefined}
              title="Klik untuk memilih · seret untuk mengurutkan · klik kanan untuk menghapus"
              onClick={() => p.onSelectDeck(d.id)}
              onContextMenu={(e) => openMenu(e, d.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData(DECK_TYPE, String(i))
                e.dataTransfer.effectAllowed = 'move'
                setDragging(i)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DECK_TYPE)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (over !== i) setOver(i)
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                const from = e.dataTransfer.getData(DECK_TYPE)
                if (from === '') return
                e.preventDefault()
                e.stopPropagation()
                setDragging(null)
                setOver(null)
                p.onMoveDeck(Number(from), i)
              }}
            >
              <FileIcon className="ph" size={18} />
              <span className="name" title={d.name}>
                {d.name}
              </span>
              <span className="meta">{d.slides.length} slide</span>
            </button>
          )
        )}
        {p.imports.map((x) =>
          x.status === 'error' ? (
            <button
              key={x.id}
              className="deck err"
              title="Klik untuk menutup"
              data-testid="import-error"
              onClick={() => p.onDismissImport(x.id)}
            >
              <WarningCircleIcon className="ph" size={18} />
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="meta">{x.meta ?? 'Gagal'}</span>
              {x.message && <span className="msg">{x.message}</span>}
            </button>
          ) : (
            // Importing rows are not decks yet: no drag, no delete (v1 cannot cancel).
            <div key={x.id} className="deck busy" aria-busy="true" data-testid="import-busy">
              <FileIcon className="ph" size={18} />
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="meta">{importMeta(x.percent)}</span>
              <span className="bar">
                <i style={{ width: `${x.percent}%` }} />
              </span>
            </div>
          )
        )}
      </div>
      {menu && (
        <DeckMenu
          at={menu}
          onClose={closeMenu}
          onRemove={() => {
            setConfirm(menu.deckId)
            setMenu(null)
          }}
        />
      )}
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
