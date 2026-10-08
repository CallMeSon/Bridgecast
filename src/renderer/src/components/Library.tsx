import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FilePdfIcon,
  FilePptIcon,
  ImageIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon
} from '@phosphor-icons/react'
import { DECK_NAME_MAX, type DeckMeta } from '../../../shared/types'
import type { ShownSlide } from '../../../shared/program'
import type { ImportProgress } from '../../../shared/ipc'
import { errorMessage, fileKind, importMeta } from '../model'

/** An import row: main's progress, plus an optional label for the error meta. */
export type ImportRow = ImportProgress & { meta?: string }

const DECK_TYPE = 'application/x-ppt-share-deck'

interface Props {
  decks: DeckMeta[]
  imports: ImportRow[]
  currentDeckId: string | null
  /** The slide on the output while Program is LIVE (not frozen, black or standby). */
  live: ShownSlide | null
  canImport: boolean
  /** URL of the active event's KV image, or null. */
  kvUrl: string | null
  /** The KV image is on the output now; it cannot be removed meanwhile. */
  kvOnAir: boolean
  /** Rejects with an Indonesian message when main refuses the image. */
  onSetKv(file: File): Promise<void>
  onClearKv(): Promise<void>
  onSelectDeck(deckId: string): void
  onDismissImport(id: string): void
  onFiles(files: File[]): void
  onMoveDeck(from: number, to: number): void
  onRemoveDeck(deckId: string): void
  /** Rejects with an Indonesian message when main refuses the name. */
  onRenameDeck(deckId: string, name: string): Promise<void>
}

interface MenuAt {
  deckId: string
  x: number
  y: number
}

/** Right-click menu of a deck; closes on Escape, outside click, scroll or blur. */
function DeckMenu({
  at,
  onRename,
  onRemove,
  onClose
}: {
  at: MenuAt
  onRename(): void
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
      <button role="menuitem" onClick={onRename}>
        <PencilSimpleIcon className="chk" size={16} />
        Ganti nama…
        <kbd className="opt">F2</kbd>
      </button>
      <button role="menuitem" className="danger" onClick={onRemove}>
        <TrashIcon className="chk" size={16} />
        Hapus deck…
      </button>
    </div>
  )
}

/**
 * Inline rename in place of the deck row: Enter or leaving the field saves,
 * Escape cancels. Main validates the name; its message stays under the field.
 */
function RenameRow({
  deck,
  onSave,
  onDone
}: {
  deck: DeckMeta
  onSave(name: string): Promise<void>
  /** `restoreFocus`: the input had focus, so the deck's row button should take it. */
  onDone(restoreFocus: boolean): void
}): React.JSX.Element {
  const [value, setValue] = useState(deck.name)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  // Set once the row is closing, so the blur that follows never saves again.
  const done = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const errorId = `rename-error-${deck.id}`
  const finish = (restoreFocus: boolean): void => {
    done.current = true
    onDone(restoreFocus)
  }
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  // Enter shows a failure under the field and keeps the row open. Leaving the
  // field (blur) never traps focus: on failure the row closes, old name kept.
  const save = async (by: 'enter' | 'blur', focused: boolean): Promise<void> => {
    if (busy.current || done.current) return
    if (value.trim() === deck.name) return finish(focused)
    busy.current = true
    try {
      await onSave(value)
      finish(focused)
    } catch (e) {
      if (by === 'blur') finish(focused)
      else {
        setError(errorMessage(e))
        input.current?.focus()
      }
    } finally {
      busy.current = false
    }
  }
  return (
    <div className="deck rename" data-no-shortcuts data-testid="rename-deck">
      {deck.source === 'pdf' ? (
        <FilePdfIcon className="ph" size={20} />
      ) : (
        <FilePptIcon className="ph" size={20} />
      )}
      <input
        ref={input}
        className="text-input"
        aria-label={`Nama baru untuk ${deck.name}`}
        value={value}
        maxLength={DECK_NAME_MAX}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save('enter', true)
          if (e.key === 'Escape') {
            e.stopPropagation()
            finish(true)
          }
        }}
        onBlur={(e) => void save('blur', e.relatedTarget === null)}
      />
      {error && (
        <span id={errorId} className="msg" role="alert">
          {error}
        </span>
      )}
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
      <TrashIcon className="ph" size={20} />
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

/** "KV acara": the event's hold image (shown on the output on demand and while STANDBY). */
function KvBlock({
  kvUrl,
  onAir,
  canEdit,
  onSet,
  onClear
}: {
  kvUrl: string | null
  onAir: boolean
  canEdit: boolean
  onSet(file: File): Promise<void>
  onClear(): Promise<void>
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="kv-block" role="group" aria-label="KV acara" data-testid="kv-block">
      <div className="kv-head">KV acara</div>
      <div className="kv-body">
        <div className="kv-thumb" data-testid="kv-thumb" data-empty={kvUrl === null}>
          {kvUrl ? (
            <img src={kvUrl} alt="KV acara" draggable={false} />
          ) : (
            <span>
              <ImageIcon size={16} />
              Belum ada KV
            </span>
          )}
        </div>
        <div className="kv-actions">
          <button
            className="btn sm"
            disabled={!canEdit || busy}
            onClick={() => input.current?.click()}
          >
            {kvUrl ? 'Ganti gambar' : 'Pilih gambar'}
          </button>
          {kvUrl && (
            <button className="btn sm" disabled={busy || onAir} onClick={() => void run(onClear)}>
              Hapus
            </button>
          )}
        </div>
      </div>
      {kvUrl && onAir && (
        <p className="kv-hint" data-testid="kv-hint">
          Matikan KV dulu untuk menghapus.
        </p>
      )}
      {error && (
        <p className="kv-error" role="alert" data-testid="kv-error">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="kv-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void run(() => onSet(file))
        }}
      />
    </div>
  )
}

export function Library(p: Props): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const count = p.decks.length
  const closeMenu = useCallback(() => setMenu(null), [])
  // Deck whose row button takes focus once its rename row has closed.
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const id = refocus.current
    if (renaming !== null || id === null) return
    refocus.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    ;[...document.querySelectorAll<HTMLElement>('.decks [data-deck-id]')]
      .find((el) => el.dataset.deckId === id)
      ?.focus()
  }, [renaming])

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
    <aside className="left" aria-label="Deck acara">
      <div className="colhead">
        <h2>Deck acara</h2>
        <span className="meta">{count} file</span>
      </div>
      <div className="decks" data-testid="decks">
        {count === 0 && p.imports.length === 0 && (
          <div className="empty-lib">Belum ada deck di event ini.</div>
        )}
        {p.decks.map((d, i) =>
          renaming === d.id ? (
            <RenameRow
              key={d.id}
              deck={d}
              onSave={(name) => p.onRenameDeck(d.id, name)}
              onDone={(restoreFocus) => {
                if (restoreFocus) refocus.current = d.id
                setRenaming((r) => (r === d.id ? null : r))
              }}
            />
          ) : confirm === d.id ? (
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
              className={
                'deck' +
                (p.live?.deckId === d.id ? ' live' : '') +
                (dragging === i ? ' dragging' : '') +
                (over === i ? ' over' : '')
              }
              data-deck-id={d.id}
              draggable
              aria-current={d.id === p.currentDeckId ? 'true' : undefined}
              title="Klik untuk menayangkan, seret untuk mengurutkan, F2 atau klik kanan untuk ganti nama atau hapus"
              onClick={() => p.onSelectDeck(d.id)}
              onKeyDown={(e) => {
                if (e.key !== 'F2') return
                e.preventDefault()
                setConfirm(null)
                setRenaming(d.id)
              }}
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
              {d.source === 'pdf' ? (
                <FilePdfIcon className="ph" size={20} />
              ) : (
                <FilePptIcon className="ph" size={20} />
              )}
              <span className="name" title={d.name}>
                {d.name}
              </span>
              <span className="meta">{d.slides.length} slide</span>
              <span className="sub">
                {p.live?.deckId === d.id ? `LIVE, slide ${p.live.index + 1}` : `.${d.source}`}
              </span>
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
              <WarningCircleIcon className="ph" size={20} />
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="meta">{x.meta ?? 'Gagal'}</span>
              {x.message && <span className="msg">{x.message}</span>}
            </button>
          ) : (
            // Importing rows are not decks yet: no drag, no delete (v1 cannot cancel).
            <div key={x.id} className="deck busy" aria-busy="true" data-testid="import-busy">
              {fileKind(x.name) === 'pdf' ? (
                <FilePdfIcon className="ph" size={20} />
              ) : (
                <FilePptIcon className="ph" size={20} />
              )}
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="n">{x.percent}%</span>
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
          onRename={() => {
            setRenaming(menu.deckId)
            setMenu(null)
          }}
          onRemove={() => {
            setConfirm(menu.deckId)
            setMenu(null)
          }}
        />
      )}
      <KvBlock
        kvUrl={p.kvUrl}
        onAir={p.kvOnAir}
        canEdit={p.canImport}
        onSet={p.onSetKv}
        onClear={p.onClearKv}
      />
      <div className="add">
        <button className="btn" disabled={!p.canImport} onClick={() => input.current?.click()}>
          <PlusIcon size={16} />
          Tambah file
        </button>
        <p>Atau seret file .pptx, .ppt, .pdf ke jendela ini.</p>
      </div>
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
