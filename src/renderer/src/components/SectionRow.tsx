import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DotsThreeVerticalIcon,
  PencilSimpleIcon,
  TrashIcon
} from '@phosphor-icons/react'
import { DECK_NAME_MAX, type SectionMeta } from '../../../shared/types'
import { errorMessage } from '../model'
import { onMenuKeyDown, useContextMenu } from './menuNav'

export interface SectionMenuAt {
  sectionId: string
  x: number
  y: number
}

/** Right-click menu of a section; closes like the deck menu. */
export function SectionMenu({
  at,
  canUp,
  canDown,
  onRename,
  onMove,
  onRemove,
  onClose
}: {
  at: SectionMenuAt
  canUp: boolean
  canDown: boolean
  onRename(): void
  onMove(dir: -1 | 1): void
  onRemove(): void
  onClose(): void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useContextMenu(ref, `.decks [data-section-id="${CSS.escape(at.sectionId)}"]`, onClose)
  return (
    <div
      ref={ref}
      className="menu ctx-menu"
      role="menu"
      aria-label="Section menu"
      data-no-shortcuts
      onKeyDown={onMenuKeyDown}
      style={{ left: at.x, top: at.y }}
      data-testid="section-menu"
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
        Remove section
      </button>
    </div>
  )
}

/** Inline rename in place of the section row; same behaviour as the deck's RenameRow. */
export function SectionRenameRow({
  section,
  onSave,
  onDone
}: {
  section: SectionMeta
  onSave(name: string): Promise<void>
  /** `restoreFocus`: the input had focus, so the section's row button should take it. */
  onDone(restoreFocus: boolean): void
}): React.JSX.Element {
  const [value, setValue] = useState(section.name)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  // Set once the row is closing, so the blur that follows never saves again.
  const done = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const errorId = `rename-error-${section.id}`
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
    if (value.trim() === section.name) return finish(focused)
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
    <div className="section rename" data-no-shortcuts data-testid="rename-section">
      <span className="tag">SECTION</span>
      <input
        ref={input}
        className="text-input"
        aria-label={`New name for section ${section.name}`}
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

/**
 * A section divider in the deck list: thin row, no thumbnail. Click takes the first
 * slide of the section live. The row button and its options button are siblings.
 */
export function SectionRow({
  section,
  dragging,
  over,
  menuOpen,
  onSelect,
  onKeyDown,
  onContextMenu,
  onOptions,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  section: SectionMeta
  dragging: boolean
  over: boolean
  menuOpen: boolean
  onSelect(): void
  onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void
  onContextMenu(e: React.MouseEvent<HTMLButtonElement>): void
  onOptions(e: React.MouseEvent<HTMLButtonElement>): void
  onDragStart(e: React.DragEvent<HTMLButtonElement>): void
  onDragEnd(): void
  onDragOver(e: React.DragEvent<HTMLButtonElement>): void
  onDragLeave(): void
  onDrop(e: React.DragEvent<HTMLButtonElement>): void
}): React.JSX.Element {
  return (
    <div className="deck-row section-row">
      <button
        className={'section' + (dragging ? ' dragging' : '') + (over ? ' over' : '')}
        data-section-id={section.id}
        data-testid="section-row"
        aria-label={`Section ${section.name}`}
        draggable
        title="Click to take the first slide of this section live. Drag, or press Alt+↑/↓, to reorder. F2 or right-click to rename or remove."
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className="tag" aria-hidden="true">
          SECTION
        </span>
        <span className="name" title={section.name}>
          {section.name}
        </span>
      </button>
      <button
        className="deck-more"
        aria-label={`Options for section ${section.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Rename or remove"
        data-testid="section-more"
        onClick={onOptions}
      >
        <DotsThreeVerticalIcon size={18} weight="bold" />
      </button>
    </div>
  )
}
