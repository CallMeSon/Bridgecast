import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UploadSimpleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { displayCanvas, type Canvas } from '../../../shared/canvas'
import { pickDisplay } from '../../../shared/displays'
import type { EventOutputs, NewEventOptions } from '../../../shared/event-outputs'
import { errorMessage, hasFiles } from '../model'
import {
  addDeckFiles,
  canvasChoices,
  canvasOfChoice,
  checkEventName,
  EVENT_NAME_MAX
} from '../new-event'
import { Switch } from './Switch'
import type { OutputSettingsState } from './useOutputSettings'

interface Props {
  /** Names of the existing events, to refuse a duplicate. */
  existing: readonly string[]
  /** This PC's output settings: the default canvas, the HDMI display and what is on now. */
  output: OutputSettingsState
  /**
   * Creates and opens the event with its canvas and outputs, then imports `files` into it as
   * decks. Rejects with a user-facing message when main refuses.
   */
  onSubmit(name: string, files: File[], options: NewEventOptions): Promise<void>
  /** Closes the dialog; `restoreFocus` is true when the keyboard closed it. */
  onClose(restoreFocus: boolean): void
}

/** Every file inside a dropped folder, subfolders included. */
async function filesInFolder(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = dir.createReader()
  const entries: FileSystemEntry[] = []
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject)
    )
    if (batch.length === 0) break
    entries.push(...batch)
  }
  const files: File[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      files.push(...(await filesInFolder(entry as FileSystemDirectoryEntry)))
    } else {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        )
      )
    }
  }
  return files
}

/** The files of a drop; a dropped folder gives the files inside it. */
async function filesOfDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []).filter((it) => it.kind === 'file')
  if (items.length === 0) return Array.from(dt.files)
  // Entries must be read before the first await: the drop's items are gone after it.
  const picked = items.map((it) => ({ entry: it.webkitGetAsEntry?.(), file: it.getAsFile() }))
  const files: File[] = []
  for (const { entry, file } of picked) {
    if (entry?.isDirectory) {
      files.push(...(await filesInFolder(entry as FileSystemDirectoryEntry).catch(() => [])))
    } else if (file) files.push(file)
  }
  return files
}

const FOCUSABLE = 'input, select, button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

const OUTPUTS: readonly { key: keyof EventOutputs; label: string }[] = [
  { key: 'hdmi', label: 'HDMI' },
  { key: 'omt', label: 'OMT' },
  { key: 'ndi', label: 'NDI' }
]

/**
 * "New event": a modal with a Name field, the event's Canvas and Outputs, and an optional list
 * of decks to import (files or a folder, dropped or chosen). Canvas and Outputs start from this
 * PC's settings, so an event created without touching them changes nothing. Focus stays inside (Tab wraps), Escape, the scrim
 * or Cancel closes it, Enter creates. The caller returns focus to the opener on `onClose(true)`.
 */
export function NewEventDialog({ existing, output, onSubmit, onClose }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [skipped, setSkipped] = useState(0)
  const [over, setOver] = useState(false)
  const filePicker = useRef<HTMLInputElement>(null)
  const folderPicker = useRef<HTMLInputElement | null>(null)
  const [canvasChoice, setCanvasChoice] = useState('default')
  const [custom, setCustom] = useState({ width: '', height: '' })
  const [canvasError, setCanvasError] = useState<string | null>(null)
  const customWidth = useRef<HTMLInputElement>(null)
  // What is on now on this PC: an untouched dialog saves exactly that.
  const [outputs, setOutputs] = useState<EventOutputs>(() => ({
    hdmi: output.hdmi?.enabled ?? false,
    omt: output.omt?.enabled ?? false,
    ndi: output.ndi?.enabled ?? false
  }))
  const hdmiDisplay = pickDisplay(output.displays, output.hdmi?.displayId ?? null)
  const display: Canvas | null = displayCanvas(hdmiDisplay)
  const choices = canvasChoices(output.canvas, display)

  const addFiles = (added: File[]): void => {
    const r = addDeckFiles(files, added)
    setFiles(r.files)
    setSkipped(r.skipped)
  }
  const onPicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length) addFiles(picked)
  }
  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e.dataTransfer.types)) return
    e.preventDefault()
    setOver(false)
    if (busy) return
    void filesOfDrop(e.dataTransfer).then(addFiles)
  }

  // The rest of the app is inert while the dialog is open.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    root.inert = true
    return () => {
      root.inert = false
    }
  }, [])

  useEffect(() => {
    input.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    if (busy) return
    const checked = checkEventName(name, existing)
    if (!checked.ok) {
      setError(checked.error)
      input.current?.focus()
      return
    }
    const canvas = canvasOfChoice(canvasChoice, custom, display)
    if (!canvas.ok) {
      setCanvasError(canvas.error)
      customWidth.current?.focus()
      return
    }
    setBusy(true)
    try {
      await onSubmit(checked.name, files, { canvas: canvas.canvas, outputs })
      onClose(true)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
      input.current?.focus()
    }
  }

  const close = (restoreFocus: boolean): void => {
    if (!busy) onClose(restoreFocus)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (!box.current?.contains(document.activeElement) || document.activeElement === box.current) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const errorId = `${id}-error`
  return createPortal(
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer.types)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div
        ref={box}
        className="popover modal add-web"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={`${id}-title`}
        data-no-shortcuts
        data-testid="new-event-dialog"
        onKeyDown={onKeyDown}
      >
        <form
          className="pop-section"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="pop-head">
            <h2 className="pop-title" id={`${id}-title`}>
              New event
            </h2>
            <button type="button" className="btn sm" onClick={() => close(true)}>
              <XIcon size={14} />
              Close
            </button>
          </div>
          <div className="field">
            <label htmlFor={`${id}-name`}>Name</label>
            <input
              ref={input}
              id={`${id}-name`}
              className="text-input"
              type="text"
              maxLength={EVENT_NAME_MAX}
              placeholder="Annual gala"
              value={name}
              autoComplete="off"
              required
              aria-required="true"
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              data-testid="new-event-name"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
            {error && (
              <p id={errorId} className="pop-error" role="alert" data-testid="new-event-error">
                <WarningCircleIcon size={16} />
                {error}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-canvas`}>Canvas</label>
            <select
              id={`${id}-canvas`}
              className="text-input"
              value={canvasChoice}
              disabled={busy}
              data-testid="new-event-canvas"
              onChange={(e) => {
                setCanvasChoice(e.target.value)
                setCanvasError(null)
              }}
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value} disabled={c.disabled}>
                  {c.label}
                </option>
              ))}
            </select>
            {canvasChoice === 'custom' && (
              <div className="ne-custom" role="group" aria-label="Custom size">
                {(['width', 'height'] as const).map((side) => (
                  <input
                    key={side}
                    ref={side === 'width' ? customWidth : undefined}
                    className="text-input num"
                    type="number"
                    inputMode="numeric"
                    aria-label={side === 'width' ? 'Width' : 'Height'}
                    placeholder={side === 'width' ? '1920' : '1080'}
                    value={custom[side]}
                    disabled={busy}
                    aria-invalid={canvasError !== null || undefined}
                    aria-describedby={canvasError ? `${id}-canvas-error` : undefined}
                    data-testid={`new-event-${side}`}
                    onChange={(e) => {
                      setCustom((c) => ({ ...c, [side]: e.target.value }))
                      setCanvasError(null)
                    }}
                  />
                ))}
                <span className="px">px</span>
              </div>
            )}
            {canvasError ? (
              <p
                id={`${id}-canvas-error`}
                className="pop-error"
                role="alert"
                data-testid="new-event-canvas-error"
              >
                <WarningCircleIcon size={16} />
                {canvasError}
              </p>
            ) : (
              <span className="hint">The size of the picture this event sends to the outputs.</span>
            )}
          </div>
          <div className="field" role="group" aria-labelledby={`${id}-outputs`}>
            <span className="ne-label" id={`${id}-outputs`}>
              Outputs
            </span>
            <div className="ne-outputs">
              {OUTPUTS.map(({ key, label }) => (
                <div className="ne-output" key={key}>
                  <span id={`${id}-out-${key}`}>{label}</span>
                  <Switch
                    id={`${id}-sw-${key}`}
                    labelledBy={`${id}-out-${key}`}
                    checked={outputs[key]}
                    disabled={busy}
                    testId={`new-event-out-${key}`}
                    onChange={(on) => setOutputs((o) => ({ ...o, [key]: on }))}
                  />
                </div>
              ))}
            </div>
            <span className="hint">
              {outputs.hdmi && !hdmiDisplay
                ? 'No second display is connected: HDMI stays off until one is. '
                : ''}
              Switched when this event takes the output. The Output panel can still change them.
            </span>
          </div>
          <div className="field">
            <label htmlFor={`${id}-files`}>
              Decks <span className="hint">(optional)</span>
            </label>
            <div className={over ? 'ne-drop over' : 'ne-drop'} data-testid="new-event-drop">
              <UploadSimpleIcon size={20} aria-hidden="true" />
              <p>Drop PPTX, PPT or PDF files here, or a folder that holds them.</p>
              <div className="ne-drop-actions">
                <button
                  type="button"
                  id={`${id}-files`}
                  className="btn sm"
                  disabled={busy}
                  onClick={() => filePicker.current?.click()}
                >
                  Choose files
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy}
                  onClick={() => folderPicker.current?.click()}
                >
                  Choose folder
                </button>
              </div>
            </div>
            <input
              ref={filePicker}
              type="file"
              multiple
              accept=".pptx,.ppt,.pdf"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="new-event-files"
              onChange={onPicked}
            />
            <input
              ref={(el) => {
                folderPicker.current = el
                el?.setAttribute('webkitdirectory', '')
              }}
              type="file"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="new-event-folder"
              onChange={onPicked}
            />
            {files.length > 0 && (
              <ul className="ne-files" aria-label="Decks to import" data-testid="new-event-list">
                {files.map((f) => (
                  <li key={`${f.name}:${f.size}`}>
                    <span className="ne-file-name">{f.name}</span>
                    <button
                      type="button"
                      className="ne-file-x"
                      aria-label={`Remove ${f.name}`}
                      title="Remove"
                      disabled={busy}
                      onClick={() => setFiles((xs) => xs.filter((x) => x !== f))}
                    >
                      <XIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {skipped > 0 && (
              <p className="hint" role="status" data-testid="new-event-skipped">
                {skipped === 1 ? '1 item was' : `${skipped} items were`} left out: only PPTX, PPT or
                PDF files can be imported.
              </p>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => close(true)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              Create event
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
