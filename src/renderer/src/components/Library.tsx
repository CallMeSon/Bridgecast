import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DotsThreeVerticalIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  BrowserIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  FilePdfIcon,
  FilePptIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  NotePencilIcon,
  PauseIcon,
  ListPlusIcon,
  PencilSimpleIcon,
  PlusIcon,
  SpeakerHighIcon,
  SpeakerLowIcon,
  SpeakerSlashIcon,
  TrashIcon,
  WarningCircleIcon,
  WarningIcon
} from '@phosphor-icons/react'
import {
  DECK_NAME_MAX,
  type DeckMeta,
  type Playback,
  type SectionMeta
} from '../../../shared/types'
import { canNative, playbackOf, type EngineState } from '../../../shared/playback'
import type { ShownSlide } from '../../../shared/program'
import { webDomain, type WebStatus } from '../../../shared/web'
import type { ImportProgress } from '../../../shared/ipc'
import { DECK_FITS, sanitizeFit, type DeckFit } from '../../../shared/canvas'
import { sanitizeDeckAudio, type DeckAudio } from '../../../shared/audio-levels'
import {
  countOf,
  deckSoundLabel,
  errorMessage,
  fileKind,
  importMeta,
  reorderTarget,
  webChip,
  WEB_CHIP_TEXT,
  type WebChipKind,
  playbackChip,
  REVERT_CONFIRM,
  LO_EDIT_CONFIRM
} from '../model'
import { orderItems, type OrderItem } from '../../../shared/sections'
import { onMenuKeyDown, useContextMenu } from './menuNav'
import { DeckSound } from './DeckSound'
import { ImportFormat } from './ImportFormat'
import type { PptImportFormat } from '../../../shared/settings'
import { AddWebDialog } from './AddWebDialog'
import { SectionMenu, SectionRenameRow, SectionRow, type SectionMenuAt } from './SectionRow'

/** An import row: main's progress, plus an optional label for the error meta. */
export type ImportRow = ImportProgress & { meta?: string }

/** Drag data of both row kinds: the item's index in the ordered list (decks and sections). */
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
  /** The program of this computer (PowerPoint on Windows, LibreOffice on Linux). */
  engineName?: 'PowerPoint' | 'LibreOffice'
  /** Linux only (LibreOffice engine): what an imported PowerPoint file becomes; absent elsewhere. */
  importFormat?: { value: PptImportFormat; onChange(v: PptImportFormat): void }
  /** Indices are into the ordered list of decks and sections (`orderItems`). */
  onMoveItem(from: number, to: number): void
  onRemoveDeck(deckId: string): void
  /** Rejects with a user-facing message when main refuses the name. */
  onRenameDeck(deckId: string, name: string): Promise<void>
  /** How the deck fills the canvas; App saves it and reports a failure itself. */
  onSetDeckFit(deckId: string, fit: DeckFit): void
  /** Volume and mute of the deck; App saves it and reports a failure itself. */
  onSetDeckAudio(deckId: string, audio: DeckAudio): void
  /** Load state of every open web deck page. */
  webStatuses: Record<string, WebStatus>
  /** The web deck on HOLD (live or frozen, lost its connection): its row shows the HOLD chip. */
  holdDeckId: string | null
  /** Adds a web deck to the active event; rejects with a user-facing message. */
  onAddWeb(url: string, name: string | undefined): Promise<void>
  /** Changes the page of a web deck; rejects with a user-facing message. */
  onSetWebUrl(deckId: string, url: string): Promise<void>
  onReloadWeb(deckId: string): void
  onPrepareWeb(deckId: string): void
  /** Session state of each native deck (the chip of its row). */
  engine: Record<string, EngineState>
  /** Decks the operator opened in PowerPoint and has not finished (Done editing shows). */
  editing: string[]
  /** The deck's file differs from the imported one (Revert is available). */
  isEdited(deckId: string): Promise<boolean>
  onEditDeck(deckId: string, confirmed?: boolean): void
  onEditDone(deckId: string): void
  onRevertDeck(deckId: string): void
  onSetPlayback(deckId: string, playback: Playback): void
  sections: SectionMeta[]
  /** `at` is a deck index (the section goes before that deck). Resolves to the new section's id. */
  onAddSection(at: number | 'end'): Promise<string | null>
  /** Rejects with a user-facing message when main refuses the name. */
  onRenameSection(sectionId: string, name: string): Promise<void>
  onRemoveSection(sectionId: string): void
  onSelectSection(sectionId: string): void
}

interface MenuAt {
  deckId: string
  x: number
  y: number
}

const PLAYBACK_NAMES = (app: string): Record<Playback, { name: string; hint: string }> => ({
  native: {
    name: 'Native',
    hint: `${app} plays the slide show: animations, transitions and video`
  },
  vector: { name: 'Vector', hint: 'Sharp pages drawn from the file, no animation' },
  images: { name: 'Still images', hint: 'The imported pictures of the slides' }
})

/** The playback modes this deck can use, in menu order (a PDF has no Native). */
function playbackOptions(d: DeckMeta | undefined): Playback[] {
  if (!d || d.source === 'web') return []
  const out: Playback[] = []
  if (canNative(d)) out.push('native')
  if (d.source === 'pptx' || d.source === 'pdf') out.push('vector')
  out.push('images')
  return out
}

const FIT_NAMES: Record<DeckFit, { name: string; hint: string }> = {
  fit: { name: 'Fit', hint: 'Whole slide, black bars where the shapes differ' },
  fill: { name: 'Fill', hint: 'Fills the canvas, edges may be cropped' },
  stretch: { name: 'Stretch', hint: 'Fills the canvas, the picture is distorted' }
}

/** Right-click menu of a deck; closes on Escape, outside click, scroll or blur. */
function DeckMenu({
  at,
  canUp,
  canDown,
  fit,
  web,
  holdsFirst = false,
  powerPoint,
  appName,
  options,
  editing,
  edited,
  playback,
  onEdit,
  onEditDone,
  onRevert,
  onPlayback,
  onPrepare,
  onEditUrl,
  onReload,
  onRename,
  onSound,
  onFit,
  onMove,
  onAddSection,
  onRemove,
  onClose
}: {
  at: MenuAt
  canUp: boolean
  canDown: boolean
  fit: DeckFit
  /** A web deck: Prepare, Edit URL and Reload instead of the Fit items. */
  web: boolean
  /** The web deck is on air and not frozen: Edit URL and Reload put the output on HOLD first. */
  holdsFirst?: boolean
  /** A PowerPoint deck: Edit in PowerPoint and Revert. */
  powerPoint: boolean
  /** The program that plays and edits it on this computer. */
  appName: string
  /** Opened in PowerPoint and not finished. */
  editing: boolean
  /** The file differs from the imported one; null while that is being read. */
  edited: boolean | null
  playback: Playback
  onEdit(): void
  onEditDone(): void
  onRevert(): void
  onPlayback(p: Playback): void
  options: Playback[]
  onPrepare(): void
  onEditUrl(): void
  onReload(): void
  onRename(): void
  onSound(): void
  onFit(fit: DeckFit): void
  onMove(dir: -1 | 1): void
  onAddSection(): void
  onRemove(): void
  onClose(): void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Escape hands focus back to the deck the menu was opened on.
  useContextMenu(ref, `.decks [data-deck-id="${CSS.escape(at.deckId)}"]`, onClose)
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
      {web && (
        <>
          <button role="menuitem" onClick={onPrepare}>
            <BrowserIcon className="chk" size={16} />
            Prepare…
          </button>
          <button role="menuitem" onClick={onEditUrl}>
            <LinkIcon className="chk" size={16} />
            Edit URL
            {holdsFirst && <span className="menu-note">HOLD first</span>}
          </button>
          <button role="menuitem" onClick={onReload}>
            <ArrowsClockwiseIcon className="chk" size={16} />
            Reload
            {holdsFirst && <span className="menu-note">HOLD first</span>}
          </button>
          <hr />
        </>
      )}
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
      <button role="menuitem" onClick={onAddSection}>
        <ListPlusIcon className="chk" size={16} />
        Add section above
      </button>
      <button role="menuitem" onClick={onSound}>
        <SpeakerHighIcon className="chk" size={16} />
        Sound…
      </button>
      {powerPoint && (
        <>
          <hr />
          <button role="menuitem" onClick={onEdit}>
            <NotePencilIcon className="chk" size={16} />
            Edit in {appName}
          </button>
          {editing && (
            <button role="menuitem" onClick={onEditDone}>
              <CheckIcon className="chk" size={16} />
              Done editing
            </button>
          )}
          <button role="menuitem" disabled={edited !== true} onClick={onRevert}>
            <ArrowCounterClockwiseIcon className="chk" size={16} />
            Revert to imported file
          </button>
        </>
      )}
      {options.length > 0 && (
        <>
          <hr />
          <div role="group" aria-labelledby="deck-playback-label">
            <span className="menu-label" id="deck-playback-label">
              Playback
            </span>
            {options.map((o) => (
              <button
                key={o}
                role="menuitemradio"
                aria-checked={playback === o}
                title={PLAYBACK_NAMES(appName)[o].hint}
                onClick={() => onPlayback(o)}
              >
                {playback === o ? (
                  <CheckIcon className="chk" size={16} />
                ) : (
                  <span className="chk" />
                )}
                {PLAYBACK_NAMES(appName)[o].name}
              </button>
            ))}
          </div>
        </>
      )}
      {!web && (
        <>
          <hr />
          <div role="group" aria-labelledby="deck-fit-label">
            <span className="menu-label" id="deck-fit-label">
              Display mode
            </span>
            {DECK_FITS.map((f) => (
              <button
                key={f}
                role="menuitemradio"
                aria-checked={fit === f}
                title={FIT_NAMES[f].hint}
                onClick={() => onFit(f)}
              >
                {/* The check mark is the shape cue; the empty slot keeps the names aligned. */}
                {fit === f ? <CheckIcon className="chk" size={16} /> : <span className="chk" />}
                {FIT_NAMES[f].name}
              </button>
            ))}
          </div>
        </>
      )}
      <hr />
      <button role="menuitem" className="danger" onClick={onRemove}>
        <TrashIcon className="chk" size={16} />
        Remove deck…
      </button>
    </div>
  )
}

/** Icon of a deck row by source. */
function DeckIcon({ source }: { source: DeckMeta['source'] }): React.JSX.Element {
  if (source === 'pdf') return <FilePdfIcon className="ph" size={20} />
  if (source === 'web') return <GlobeIcon className="ph" size={20} />
  return <FilePptIcon className="ph" size={20} />
}

const CHIP_ICON: Record<WebChipKind, React.JSX.Element> = {
  loading: <CircleDashedIcon size={14} />,
  ready: <CheckCircleIcon size={14} weight="fill" />,
  error: <WarningIcon size={14} weight="fill" />,
  hold: <PauseIcon size={14} weight="fill" />
}

/**
 * Load state of a web deck's page: words plus a shape (dashed ring, check, triangle,
 * pause bars), never colour alone. HOLD is the filled one: the live page is held.
 */
function WebChip({ kind }: { kind: WebChipKind }): React.JSX.Element {
  return (
    <span className="chip" data-kind={kind} data-testid="web-chip">
      {CHIP_ICON[kind]}
      {WEB_CHIP_TEXT[kind]}
    </span>
  )
}

/**
 * Speaker mark on a deck whose sound is not at full volume: the icon sits beside the
 * words ("Muted" or the level), and carries the full label for screen readers.
 */
function DeckSoundMark({ audio }: { audio: DeckAudio | undefined }): React.JSX.Element | null {
  const label = deckSoundLabel(audio)
  if (!label) return null
  const a = sanitizeDeckAudio(audio)
  const Icon = a.muted ? SpeakerSlashIcon : SpeakerLowIcon
  return (
    <span className="snd" title={label} data-testid="deck-sound-mark">
      <Icon size={14} role="img" aria-label={label} />
      <span aria-hidden="true">{a.muted ? 'Muted' : `${a.volume}%`}</span>
    </span>
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
      <DeckIcon source={deck.source} />
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

/** Inline warning in place of the deck row before Edit in LibreOffice (no modal). */
function ConfirmEdit({
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
      aria-label={`Edit ${deck.name} in LibreOffice`}
      data-no-shortcuts
      data-testid="confirm-edit"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <NotePencilIcon className="ph" size={20} />
      <span className="name" title={deck.name}>
        {LO_EDIT_CONFIRM}
      </span>
      <span className="msg">{deck.name}</span>
      <span className="actions">
        <button className="btn sm" data-testid="edit-yes" onClick={onConfirm}>
          Edit in LibreOffice
        </button>
        <button ref={cancel} className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  )
}

/** Inline confirmation in place of the deck row before Revert (no modal). */
function ConfirmRevert({
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
      aria-label={`Revert ${deck.name}`}
      data-no-shortcuts
      data-testid="confirm-revert"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <ArrowCounterClockwiseIcon className="ph" size={20} />
      <span className="name" title={deck.name}>
        {REVERT_CONFIRM}
      </span>
      <span className="msg">{deck.name}</span>
      <span className="actions">
        <button className="btn sm danger" data-testid="revert-yes" onClick={onConfirm}>
          Revert
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

/** Key of a row in the ordered list, for restoring focus after the DOM node is replaced. */
const rowKey = (item: OrderItem): string =>
  'deck' in item ? `deck:${item.deck}` : `section:${item.section}`

function focusRow(key: string): void {
  const sep = key.indexOf(':')
  const attr = key.slice(0, sep) === 'deck' ? 'deckId' : 'sectionId'
  const id = key.slice(sep + 1)
  ;[...document.querySelectorAll<HTMLElement>('.decks [data-deck-id], .decks [data-section-id]')]
    .find((el) => el.dataset[attr] === id)
    ?.focus()
}

const menuOpenId = (m: MenuAt | null): string | null => (m ? m.deckId : null)

export function Library(p: Props): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<MenuAt | null>(null)
  const [sectionMenu, setSectionMenu] = useState<SectionMenuAt | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null)
  const [confirmEdit, setConfirmEdit] = useState<string | null>(null)
  // Whether a deck differs from its imported file, read when its menu opens.
  const [editedRead, setEditedRead] = useState<{ id: string; edited: boolean } | null>(null)
  const menuDeckId = menuOpenId(menu)
  const menuEdited = editedRead && editedRead.id === menuDeckId ? editedRead.edited : null
  const { isEdited } = p
  useEffect(() => {
    if (menuDeckId === null) return
    let fresh = true
    isEdited(menuDeckId).then(
      (edited) => fresh && setEditedRead({ id: menuDeckId, edited }),
      () => fresh && setEditedRead({ id: menuDeckId, edited: false })
    )
    return () => {
      fresh = false
    }
  }, [menuDeckId, isEdited])
  const [sound, setSound] = useState<MenuAt | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // The Add web page dialog, or the Edit URL one of a web deck.
  const [webDialog, setWebDialog] = useState<'add' | { deckId: string } | null>(null)
  const addWebButton = useRef<HTMLButtonElement>(null)
  // Where focus goes once the dialog has unmounted (the app behind it is inert until then).
  const webFocus = useRef<'add' | { deckId: string } | null>(null)
  useEffect(() => {
    const target = webFocus.current
    if (webDialog !== null || target === null) return
    webFocus.current = null
    if (target === 'add') addWebButton.current?.focus()
    else focusRow(`deck:${target.deckId}`)
  }, [webDialog])
  const [renamingSection, setRenamingSection] = useState<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const count = p.decks.length
  const items = orderItems(
    p.decks.map((d) => d.id),
    p.sections
  )
  const deckById = new Map(p.decks.map((d) => [d.id, d]))
  const sectionById = new Map(p.sections.map((s) => [s.id, s]))
  const itemIndexOf = (key: string): number => items.findIndex((it) => rowKey(it) === key)
  const menuIndex = menu ? itemIndexOf(`deck:${menu.deckId}`) : -1
  const sectionMenuIndex = sectionMenu ? itemIndexOf(`section:${sectionMenu.sectionId}`) : -1
  const closeMenu = useCallback(() => setMenu(null), [])
  const closeSectionMenu = useCallback(() => setSectionMenu(null), [])
  // Row (see `rowKey`) whose button takes focus once its rename row has closed.
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const key = refocus.current
    if (renaming !== null || renamingSection !== null || key === null) return
    refocus.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    focusRow(key)
  }, [renaming, renamingSection, confirmRevert])

  // Row that takes focus again after a keyboard move (the DOM node is re-inserted).
  const movedFocus = useRef<string | null>(null)
  useEffect(() => {
    const key = movedFocus.current
    if (key === null) return
    movedFocus.current = null
    focusRow(key)
  }, [p.decks, p.sections])
  const moveRow = (from: number, to: number): void => {
    movedFocus.current = rowKey(items[from])
    p.onMoveItem(from, to)
  }

  const addSection = (at: number | 'end'): void => {
    setConfirm(null)
    // The new section opens in rename mode (name selected), like a new file in Explorer.
    void p.onAddSection(at).then((id) => {
      if (id === null) return
      setRenaming(null)
      setRenamingSection(id)
    })
  }

  /** Menu anchor for a context-menu event; keyboard-opened menus anchor to the row. */
  const anchorOf = (e: React.MouseEvent<HTMLElement>): { x: number; y: number } => {
    let { clientX: x, clientY: y } = e
    if (x === 0 && y === 0) {
      // Keyboard (Shift+F10 / context menu key): anchor to the row.
      const r = e.currentTarget.getBoundingClientRect()
      x = r.left + 24
      y = r.bottom
    }
    return { x, y }
  }
  const openMenu = (e: React.MouseEvent<HTMLElement>, deckId: string): void => {
    e.preventDefault()
    setConfirm(null)
    setSectionMenu(null)
    setSound(null)
    setMenu({ deckId, ...anchorOf(e) })
  }
  const openSectionMenu = (e: React.MouseEvent<HTMLElement>, sectionId: string): void => {
    e.preventDefault()
    setConfirm(null)
    setMenu(null)
    setSectionMenu({ sectionId, ...anchorOf(e) })
  }

  /** Drag and drop of both row kinds; the drag data is the item index. */
  const dragProps = (
    i: number
  ): {
    onDragStart(e: React.DragEvent): void
    onDragEnd(): void
    onDragOver(e: React.DragEvent): void
    onDragLeave(): void
    onDrop(e: React.DragEvent): void
  } => ({
    onDragStart: (e) => {
      e.dataTransfer.setData(DECK_TYPE, String(i))
      e.dataTransfer.effectAllowed = 'move'
      setDragging(i)
    },
    onDragEnd: () => {
      setDragging(null)
      setOver(null)
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DECK_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== i) setOver(i)
    },
    onDragLeave: () => setOver((o) => (o === i ? null : o)),
    onDrop: (e) => {
      const from = e.dataTransfer.getData(DECK_TYPE)
      if (from === '') return
      e.preventDefault()
      e.stopPropagation()
      setDragging(null)
      setOver(null)
      p.onMoveItem(Number(from), i)
    }
  })
  /** Alt+Up/Down moves the row by one item; true when Alt was held (key fully handled here). */
  const altMove = (e: React.KeyboardEvent, i: number): boolean => {
    if (!e.altKey) return false
    // Keyboard reorder (Alt+Up/Down); never reaches the Prev/Next shortcuts.
    const to = reorderTarget(e.key, 'vertical', i, items.length)
    if (to === null) return true
    e.preventDefault()
    if (!e.repeat) moveRow(i, to)
    return true
  }

  return (
    <aside className="left" aria-label="Decks">
      <div className="colhead">
        <h2>Decks</h2>
        <span className="meta">{countOf(count, 'deck')}</span>
      </div>
      <div className="decks" data-testid="decks">
        {items.length === 0 && p.imports.length === 0 && (
          <div className="empty-lib">
            {p.canImport
              ? 'No decks in this event yet.'
              : 'No event yet. Create one from the Event menu above, then add files.'}
          </div>
        )}
        {items.map((item, i) => {
          if ('section' in item) {
            const sec = sectionById.get(item.section)
            if (!sec) return null
            if (renamingSection === sec.id) {
              return (
                <SectionRenameRow
                  key={`s-${sec.id}`}
                  section={sec}
                  onSave={(name) => p.onRenameSection(sec.id, name)}
                  onDone={(restoreFocus) => {
                    if (restoreFocus) refocus.current = `section:${sec.id}`
                    setRenamingSection((r) => (r === sec.id ? null : r))
                  }}
                />
              )
            }
            return (
              <SectionRow
                key={`s-${sec.id}`}
                section={sec}
                dragging={dragging === i}
                over={over === i}
                menuOpen={sectionMenu?.sectionId === sec.id}
                onSelect={() => p.onSelectSection(sec.id)}
                onKeyDown={(e) => {
                  if (altMove(e, i) || e.key !== 'F2') return
                  e.preventDefault()
                  setRenamingSection(sec.id)
                }}
                onContextMenu={(e) => openSectionMenu(e, sec.id)}
                onOptions={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setConfirm(null)
                  setMenu(null)
                  setSectionMenu({
                    sectionId: sec.id,
                    x: Math.max(8, r.right - 200),
                    y: r.bottom + 4
                  })
                }}
                {...dragProps(i)}
              />
            )
          }
          const d = deckById.get(item.deck)
          if (!d) return null
          return renaming === d.id ? (
            <RenameRow
              key={d.id}
              deck={d}
              onSave={(name) => p.onRenameDeck(d.id, name)}
              onDone={(restoreFocus) => {
                if (restoreFocus) refocus.current = `deck:${d.id}`
                setRenaming((r) => (r === d.id ? null : r))
              }}
            />
          ) : confirmEdit === d.id ? (
            <ConfirmEdit
              key={d.id}
              deck={d}
              onConfirm={() => {
                setConfirmEdit(null)
                refocus.current = `deck:${d.id}`
                p.onEditDeck(d.id, true)
              }}
              onCancel={() => {
                setConfirmEdit(null)
                refocus.current = `deck:${d.id}`
              }}
            />
          ) : confirmRevert === d.id ? (
            <ConfirmRevert
              key={d.id}
              deck={d}
              onConfirm={() => {
                setConfirmRevert(null)
                // The confirm row is still mounted: focus returns once it has gone.
                refocus.current = `deck:${d.id}`
                p.onRevertDeck(d.id)
              }}
              onCancel={() => {
                setConfirmRevert(null)
                refocus.current = `deck:${d.id}`
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
            <div key={d.id} className="deck-row">
              <button
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
                  if (altMove(e, i) || e.key !== 'F2') return
                  e.preventDefault()
                  setConfirm(null)
                  setRenaming(d.id)
                }}
                onContextMenu={(e) => openMenu(e, d.id)}
                {...dragProps(i)}
              >
                <DeckIcon source={d.source} />
                <span className="name" title={d.name}>
                  {d.name}
                </span>
                {d.source === 'web' ? (
                  <WebChip kind={webChip(p.webStatuses[d.id], p.holdDeckId === d.id)} />
                ) : (
                  <span className="meta">{countOf(d.slides.length, 'slide')}</span>
                )}
                <span className="sub">
                  {d.source === 'web'
                    ? (p.live?.deckId === d.id
                        ? 'LIVE, '
                        : p.frozen?.deckId === d.id
                          ? 'FROZEN, '
                          : '') + webDomain(d.web?.url ?? '')
                    : p.live?.deckId === d.id
                      ? `LIVE, slide ${p.live.index + 1}`
                      : p.frozen?.deckId === d.id
                        ? `FROZEN, slide ${p.frozen.index + 1}`
                        : `.${d.source}`}
                  {d.source !== 'web' && (
                    <span
                      className="pb"
                      data-mode={playbackOf(d)}
                      data-engine={
                        playbackOf(d) === 'native' ? (p.engine[d.id] ?? 'opening') : undefined
                      }
                      data-testid="playback-chip"
                    >
                      {playbackChip(d, p.engine[d.id] ?? null)}
                    </span>
                  )}
                  <DeckSoundMark audio={d.audio} />
                </span>
              </button>
              {/* Visible way to the deck menu (also: right-click, F2). */}
              <button
                className="deck-more"
                aria-label={`Options for ${d.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.deckId === d.id}
                title="Rename or remove"
                data-testid="deck-more"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setConfirm(null)
                  setConfirmRevert(null)
                  setSectionMenu(null)
                  setSound(null)
                  setMenu({ deckId: d.id, x: Math.max(8, r.right - 200), y: r.bottom + 4 })
                }}
              >
                <DotsThreeVerticalIcon size={18} weight="bold" />
              </button>
            </div>
          )
        })}
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
          canDown={menuIndex >= 0 && menuIndex < items.length - 1}
          fit={sanitizeFit(deckById.get(menu.deckId)?.fit)}
          web={deckById.get(menu.deckId)?.source === 'web'}
          holdsFirst={p.live?.deckId === menu.deckId}
          powerPoint={deckById.get(menu.deckId)?.source === 'pptx'}
          appName={p.engineName ?? 'PowerPoint'}
          options={playbackOptions(deckById.get(menu.deckId))}
          editing={p.editing.includes(menu.deckId)}
          edited={menuEdited}
          playback={playbackOf(deckById.get(menu.deckId) ?? ({} as DeckMeta))}
          onEdit={() => {
            focusRow(`deck:${menu.deckId}`)
            const id = menu.deckId
            setMenu(null)
            // LibreOffice may rewrite the file when it saves: ask first.
            if (p.engineName === 'LibreOffice') setConfirmEdit(id)
            else p.onEditDeck(id)
          }}
          onEditDone={() => {
            focusRow(`deck:${menu.deckId}`)
            const id = menu.deckId
            setMenu(null)
            p.onEditDone(id)
          }}
          onRevert={() => {
            setConfirmRevert(menu.deckId)
            setMenu(null)
          }}
          onPlayback={(mode) => {
            focusRow(`deck:${menu.deckId}`)
            const id = menu.deckId
            setMenu(null)
            p.onSetPlayback(id, mode)
          }}
          onPrepare={() => {
            const id = menu.deckId
            setMenu(null)
            p.onPrepareWeb(id)
          }}
          onEditUrl={() => {
            setWebDialog({ deckId: menu.deckId })
            setMenu(null)
          }}
          onReload={() => {
            focusRow(`deck:${menu.deckId}`)
            const id = menu.deckId
            setMenu(null)
            p.onReloadWeb(id)
          }}
          onClose={closeMenu}
          onMove={(dir) => {
            setMenu(null)
            moveRow(menuIndex, menuIndex + dir)
          }}
          onRename={() => {
            setRenaming(menu.deckId)
            setMenu(null)
          }}
          onSound={() => {
            setSound(menu)
            setMenu(null)
          }}
          onFit={(fit) => {
            // The menu is about to unmount: hand focus back to the deck first.
            focusRow(`deck:${menu.deckId}`)
            setMenu(null)
            p.onSetDeckFit(menu.deckId, fit)
          }}
          onAddSection={() => {
            const at = p.decks.findIndex((d) => d.id === menu.deckId)
            setMenu(null)
            if (at >= 0) addSection(at)
          }}
          onRemove={() => {
            setConfirm(menu.deckId)
            setMenu(null)
          }}
        />
      )}
      {sound && deckById.get(sound.deckId) && (
        <DeckSound
          key={sound.deckId}
          deck={deckById.get(sound.deckId)!}
          at={sound}
          onSave={(audio) => p.onSetDeckAudio(sound.deckId, audio)}
          onClose={(restoreFocus) => {
            setSound(null)
            if (restoreFocus) focusRow(`deck:${sound.deckId}`)
          }}
        />
      )}
      {sectionMenu && (
        <SectionMenu
          at={sectionMenu}
          canUp={sectionMenuIndex > 0}
          canDown={sectionMenuIndex >= 0 && sectionMenuIndex < items.length - 1}
          onClose={closeSectionMenu}
          onMove={(dir) => {
            setSectionMenu(null)
            moveRow(sectionMenuIndex, sectionMenuIndex + dir)
          }}
          onRename={() => {
            setRenamingSection(sectionMenu.sectionId)
            setSectionMenu(null)
          }}
          onRemove={() => {
            // Focus moves to the neighbouring row once the list has changed.
            const near = items[sectionMenuIndex + 1] ?? items[sectionMenuIndex - 1]
            if (near) movedFocus.current = rowKey(near)
            p.onRemoveSection(sectionMenu.sectionId)
            setSectionMenu(null)
          }}
        />
      )}
      {webDialog !== null && (
        <AddWebDialog
          key={webDialog === 'add' ? 'add' : webDialog.deckId}
          edit={
            webDialog === 'add'
              ? undefined
              : {
                  deckName: deckById.get(webDialog.deckId)?.name ?? '',
                  url: deckById.get(webDialog.deckId)?.web?.url ?? ''
                }
          }
          onSubmit={(url, name) =>
            webDialog === 'add' ? p.onAddWeb(url, name) : p.onSetWebUrl(webDialog.deckId, url)
          }
          onClose={(restoreFocus) => {
            const target = webDialog
            setWebDialog(null)
            if (!restoreFocus) return
            // Back to the opener: the Add button, or the row of the deck being edited.
            webFocus.current = target
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
        <div className="add-row">
          <button className="btn" disabled={!p.canImport} onClick={() => input.current?.click()}>
            <PlusIcon size={16} />
            Add files
          </button>
          <button
            ref={addWebButton}
            className="btn"
            disabled={!p.canImport}
            data-testid="add-web"
            onClick={() => {
              setConfirm(null)
              setMenu(null)
              setWebDialog('add')
            }}
          >
            <GlobeIcon size={16} />
            Add web page
          </button>
          <button className="btn" disabled={!p.canImport} onClick={() => addSection('end')}>
            <ListPlusIcon size={16} />
            Add section
          </button>
        </div>
        <p>
          {p.canImport
            ? 'Or drag .pptx, .ppt, or .pdf files into this window.'
            : 'Create an event in the Event menu to enable importing.'}
        </p>
        {p.importFormat && (
          <ImportFormat value={p.importFormat.value} onChange={p.importFormat.onChange} />
        )}
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
