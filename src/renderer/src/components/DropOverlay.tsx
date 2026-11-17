import { useEffect, useRef, useState } from 'react'
import { UploadSimpleIcon } from '@phosphor-icons/react'
import { hasFiles } from '../model'

export interface DroppedItems {
  files: File[]
  /** Dropped folders (a folder arrives as a content-less File; `api.pathForFile` gives its path). */
  folders: File[]
}

/** Splits a drop into files and folders (a folder also arrives as a File without content). */
function readDrop(dt: DataTransfer): DroppedItems {
  const files: File[] = []
  const folders: File[] = []
  const items = Array.from(dt.items ?? []).filter((it) => it.kind === 'file')
  if (items.length === 0) return { files: Array.from(dt.files), folders }
  for (const it of items) {
    const entry = it.webkitGetAsEntry?.()
    const file = it.getAsFile()
    if (!file) continue
    if (entry?.isDirectory) folders.push(file)
    else files.push(file)
  }
  return { files, folders }
}

/**
 * Full-window overlay while files from outside are dragged over the window
 * (counter-based dragenter/dragleave, like the mockup). Drags that reorder
 * decks or slides carry no Files and are ignored. Dropping anywhere imports.
 */
export function DropOverlay({
  onDrop,
  disabled = false
}: {
  onDrop(items: DroppedItems): void
  /** A dialog takes the drop itself: no overlay and no import, but the file never opens. */
  disabled?: boolean
}): React.JSX.Element {
  const [on, setOn] = useState(false)
  const depth = useRef(0)
  const off = useRef(disabled)
  useEffect(() => {
    off.current = disabled
    if (disabled) depth.current = 0
  }, [disabled])
  const handler = useRef(onDrop)
  useEffect(() => {
    handler.current = onDrop
  }, [onDrop])

  useEffect(() => {
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      if (off.current) return
      depth.current++
      setOn(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer?.types)) return
      if (--depth.current <= 0) {
        depth.current = 0
        setOn(false)
      }
    }
    const over = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer?.types)) return
      e.preventDefault() // allow the drop (and never let Chromium open the file)
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      depth.current = 0
      setOn(false)
      if (off.current) return
      if (e.dataTransfer) handler.current(readDrop(e.dataTransfer))
    }
    // Esc during a drag or a drag cancelled outside the window ends without dragleave
    // on some paths; a dragend/blur resets the overlay.
    const reset = (): void => {
      depth.current = 0
      setOn(false)
    }
    addEventListener('dragenter', enter)
    addEventListener('dragleave', leave)
    addEventListener('dragover', over)
    addEventListener('drop', drop)
    addEventListener('blur', reset)
    return () => {
      removeEventListener('dragenter', enter)
      removeEventListener('dragleave', leave)
      removeEventListener('dragover', over)
      removeEventListener('drop', drop)
      removeEventListener('blur', reset)
    }
  }, [])

  return (
    <div
      className={on && !disabled ? 'overlay on' : 'overlay'}
      data-testid="drop-overlay"
      aria-hidden={!on || disabled}
    >
      <span>
        <UploadSimpleIcon className="ph" size={22} />
        Drop files to add them as decks
      </span>
    </div>
  )
}
