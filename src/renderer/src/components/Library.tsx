import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
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
import { countOf, errorMessage, fileKind, importMeta, reorderTarget } from '../model'
import { menuItems, onMenuKeyDown } from './menuNav'

/** An import row: main's progress, plus an optional label for the error meta. */
export type ImportRow = ImportProgress & { meta?: string }

const DECK_TYPE = 'application/x-ppt-share-deck'

interface Props {
  decks: DeckMeta[]
  imports: ImportRow[]
  currentDeckId: string | null
  /** The slide on the output while Program is LIVE (not frozen, black or standby). */
  live: ShownSlide | null
  /** The slide still on the output while Program is FROZEN. */
  frozen: ShownSlide | null
  canImport: boolean
  /** URL of the active event's KV image, or null. */
  kvUrl: string | null
  /** The KV image is on the output now; it cannot be removed meanwhile. */
  kvOnAir: boolean
  /** Rejects with a user-facing message when main refuses the image. */
  onSetKv(file: File): Promise<void>
  onClearKv(): Promise<void>
  onSelectDeck(deckId: string): void
  onDismissImport(id: string): void
  onFiles(files: File[]): void
  onMoveDeck(from: number, to: number): void
  onRemoveDeck(deckId: string): void
  /** Rejects with a user-facing message when main refuses the name. */
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
  canUp,
  canDown,
  onRename,
  onMove,
  onRemove,
  onClose
}: {
  at: MenuAt
  canUp: boolean
  canDown: boolean
  onRename(): void
  onMove(dir: -1 | 1): void
  onRemove(): void
  onClose(): void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menuItems(ref.current!)[0]?.focus()
    const close = (e: Event): void => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key !== 'Escape') return
        // Escape hands focus back to the deck the menu was opened on.
        document
          .querySelector<HTMLElement>(`.decks [data-deck-id="${CSS.escape(at.deckId)}"]`)
          ?.focus()
      }
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
  }, [onClose, at.deckId])
  return (
    <div
      ref={ref}
      className="menu ctx-menu"
      role="menu"
      aria-label="Deck menu"
      data-no-shortcuts
      onKeyDown={onMenuKeyDown}
      style={{ left: at.x, top: at.y }}
      data-testid="deck-menu"
    >
      <button role="menuitem" onClick={onRename}>
        <PencilSimpleIcon className="chk" size={16} />
        Rename…
        <kbd className="opt">F2</kbd>
      </button>
      <button role="menuitem" disabled={!canUp} onClick={() => onMove(-1)}>
        <ArrowUpIcon className="chk" size={16} />
        Move up
        <kbd className="opt">Alt+↑</kbd>
      </button>
      <button role="menuitem" disabled={!canDown} onClick={() => onMove(1)}>
        <ArrowDownIcon className="chk" size={16} />
        Move down
        <kbd className="opt">Alt+↓</kbd>
      </button>
      <button role="menuitem" className="danger" onClick={onRemove}>
        <TrashIcon className="chk" size={16} />
        Remove deck…
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
        aria-label={`New name for ${deck.name}`}
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
      aria-label={`Remove ${deck.name}`}
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
        Remove this deck?
      </span>
      <span className="msg">
        {deck.name} · {countOf(deck.slides.length, 'slide')}. This cannot be undone.
      </span>
      <span className="actions">
        <button className="btn sm danger" onClick={onConfirm}>
          Remove
        </button>
        <button ref={cancel} className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  )
}

/** "Key visual (KV)": the event's hold image (shown on the output on demand and while STANDBY). */
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
    <div className="kv-block" role="group" aria-label="Key visual (KV)" data-testid="kv-block">
      <div className="kv-head">Key visual (KV)</div>
      <div className="kv-body">
        <div className="kv-thumb" data-testid="kv-thumb" data-empty={kvUrl === null}>
          {kvUrl ? (
            <img src={kvUrl} alt="Event key visual" draggable={false} />
          ) : (
            <span>
              <ImageIcon size={16} />
              No KV yet
            </span>
          )}
        </div>
        <div className="kv-actions">
          <button
            className="btn sm"
            disabled={!canEdit || busy}
            onClick={() => input.current?.click()}
          >
            {kvUrl ? 'Replace image' : 'Choose image'}
          </button>
          {kvUrl && (
            <button className="btn sm" disabled={busy || onAir} onClick={() => void run(onClear)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {kvUrl && onAir && (
        <p className="kv-hint" data-testid="kv-hint">
          Turn KV off first to remove it.
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
  const menuIndex = menu ? p.decks.findIndex((d) => d.id === menu.deckId) : -1
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

  // Deck whose row takes focus again after a keyboard move (the DOM node is re-inserted).
  const movedFocus = useRef<string | null>(null)
  useEffect(() => {
    const id = movedFocus.current
    if (id === null) return
    movedFocus.current = null
    ;[...document.querySelectorAll<HTMLElement>('.decks [data-deck-id]')]
      .find((el) => el.dataset.deckId === id)
      ?.focus()
  }, [p.decks])
  const moveDeck = (from: number, to: number): void => {
    movedFocus.current = p.decks[from].id
    p.onMoveDeck(from, to)
  }

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
    <aside className="left" aria-label="Decks">
      <div className="colhead">
        <h2>Decks</h2>
        <span className="meta">{countOf(count, 'deck')}</span>
      </div>
      <div className="decks" data-testid="decks">
        {count === 0 && p.imports.length === 0 && (
          <div className="empty-lib">
            {p.canImport
              ? 'No decks in this event yet.'
              : 'No event yet. Create one from the Event menu above, then add files.'}
          </div>
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
                (p.frozen?.deckId === d.id ? ' frozen' : '') +
                (dragging === i ? ' dragging' : '') +
                (over === i ? ' over' : '')
              }
              data-deck-id={d.id}
              draggable
              aria-current={d.id === p.currentDeckId ? 'true' : undefined}
              title="Click to take this deck live. Drag, or press Alt+↑/↓, to reorder. F2 or right-click to rename or remove."
              onClick={() => p.onSelectDeck(d.id)}
              onKeyDown={(e) => {
                if (e.altKey) {
                  // Keyboard reorder (Alt+Up/Down); never reaches the Prev/Next shortcuts.
                  const to = reorderTarget(e.key, 'vertical', i, count)
                  if (to === null) return
                  e.preventDefault()
                  if (!e.repeat) moveDeck(i, to)
                  return
                }
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
              <span className="meta">{countOf(d.slides.length, 'slide')}</span>
              <span className="sub">
                {p.live?.deckId === d.id
                  ? `LIVE, slide ${p.live.index + 1}`
                  : p.frozen?.deckId === d.id
                    ? `FROZEN, slide ${p.frozen.index + 1}`
                    : `.${d.source}`}
              </span>
            </button>
          )
        )}
        {p.imports.map((x) =>
          x.status === 'error' ? (
            <button
              key={x.id}
              className="deck err"
              title="Click to dismiss"
              data-testid="import-error"
              onClick={() => p.onDismissImport(x.id)}
            >
              <WarningCircleIcon className="ph" size={20} />
              <span className="name" title={x.name}>
                {x.name}
              </span>
              <span className="meta">{x.meta ?? 'Failed'}</span>
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
              <span
                className="bar"
                role="progressbar"
                aria-label={`Importing ${x.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={x.percent}
              >
                <i style={{ '--p': x.percent / 100 } as React.CSSProperties} />
              </span>
            </div>
          )
        )}
      </div>
      {menu && (
        <DeckMenu
          at={menu}
          canUp={menuIndex > 0}
          canDown={menuIndex >= 0 && menuIndex < count - 1}
          onClose={closeMenu}
          onMove={(dir) => {
            setMenu(null)
            moveDeck(menuIndex, menuIndex + dir)
          }}
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
          Add files
        </button>
        <p>
          {p.canImport
            ? 'Or drag .pptx, .ppt, or .pdf files into this window.'
            : 'Create an event in the Event menu to enable importing.'}
        </p>
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
