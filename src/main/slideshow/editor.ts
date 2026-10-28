import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { canNative } from '../../shared/playback'
import type { Library } from '../library'
import type { ImportedDeck } from '../import/pptx'

/** A save is exported this long after the last file change (PowerPoint writes in several steps). */
export const EDIT_DEBOUNCE_MS = 1000

export const EDIT_FAILED =
  'Your changes could not be loaded. The previous version is still used. Save the file again in PowerPoint.'
export const REVERT_FAILED =
  'The imported file could not be restored. The previous version is still used. Try Revert again.'

const EDIT_FILE_RE = /^edit\.(pptx|ppt)$/i

/** The parts of the library the editor uses. */
export type EditorLibrary = Pick<
  Library,
  'getDeck' | 'beginEdit' | 'editChanged' | 'discardEdit' | 'revertDeck' | 'replaceDeckFiles'
>

export interface EditorDeps {
  library: EditorLibrary
  /** Exports a PowerPoint file to PNGs, PDF and metadata (the import queue: one PowerPoint job at a time). */
  exportDeck(file: string, outDir: string): Promise<ImportedDeck>
  /** Opens the working copy in a normal PowerPoint window. */
  openInPowerPoint(file: string): Promise<void>
  /** The deck is on air (shown on an output). */
  isLive(deckId: string): boolean
  /** Closes the deck's slide show session and keeps it closed while its files are replaced. */
  suspend(deckId: string): Promise<void>
  /** The files are replaced (or kept): the slide show session may open again. */
  resume(deckId: string): void
  /** The deck's files changed: re-validate the program state. */
  applied(deckId: string): void
  /** The pending state of a deck changed. */
  onPending(deckId: string, pending: boolean): void
  /** A background export or replace failed (message says what to do). */
  onError(deckId: string, message: string): void
  /** Calls `cb` on every change of the working copy; returns the function that stops watching. */
  watch?(file: string, cb: () => void): () => void
  tempDir?(): string
}

/** `fs.watch` on the deck folder, filtered to `edit.pptx` / `edit.ppt` (PowerPoint saves by renaming). */
export function watchEditFile(file: string, cb: () => void): () => void {
  const watcher = fs.watch(path.dirname(file), (_ev, name) => {
    if (name === null || name === undefined || EDIT_FILE_RE.test(String(name))) cb()
  })
  watcher.on('error', () => {})
  return () => watcher.close()
}

interface Staged {
  imported: ImportedDeck
  tmp: string
  /** What to report when the replace fails. */
  failure: string
}

interface Watch {
  file: string
  close: () => void
  timer: ReturnType<typeof setTimeout> | null
  /** The working copy was prepared for this session (removed again if PowerPoint cannot open it). */
  fresh: boolean
}

/**
 * Edit in PowerPoint and Revert. The deck's `source.*` is copied to `edit.*` and opened in a
 * normal PowerPoint window; every save is exported again (PNGs, PDF, clicks, hidden) from a
 * snapshot of the file and swapped in with `Library.replaceDeckFiles`.
 *
 * While the deck is on air nothing changes: the new version waits as pending and is applied when
 * the deck leaves air (`leftAir`) or on `applyNow`. A failing export or replace keeps the old
 * files completely.
 */
export class DeckEditor {
  private watches = new Map<string, Watch>()
  private staged = new Map<string, Staged>()
  private pendingSet = new Set<string>()
  private applying = new Set<string>()
  private chains = new Map<string, Promise<unknown>>()
  /** What to report when applying the staged version of a deck fails. */
  private lastFailure = new Map<string, string>()

  constructor(private deps: EditorDeps) {}

  /** A saved version waits for the deck to leave air. */
  pending(deckId: string): boolean {
    return this.pendingSet.has(deckId)
  }

  /** Opens the deck's working copy in PowerPoint and exports it again on every save. */
  async edit(deckId: string): Promise<void> {
    const lib = this.deps.library
    if (!canNative(lib.getDeck(deckId))) {
      throw new Error(
        'Only a PowerPoint deck can be edited in PowerPoint. Choose a deck imported from a PPTX or PPT file.'
      )
    }
    let watch = this.watches.get(deckId)
    if (!watch) {
      const { file, fresh } = lib.beginEdit(deckId)
      let close: () => void
      try {
        close = (this.deps.watch ?? watchEditFile)(file, () => this.schedule(deckId))
      } catch {
        if (fresh) lib.discardEdit(deckId)
        throw new Error(
          'The working copy could not be watched. Close the deck folder, then try again.'
        )
      }
      watch = { file, close, timer: null, fresh }
      this.watches.set(deckId, watch)
    }
    try {
      await this.deps.openInPowerPoint(watch.file)
    } catch (err) {
      if (this.watches.get(deckId) === watch) {
        this.stopWatch(deckId)
        if (watch.fresh) lib.discardEdit(deckId)
      }
      throw err
    }
  }

  /** The operator is done: stop watching and export the last saved version at once. */
  async done(deckId: string): Promise<void> {
    const watch = this.watches.get(deckId)
    if (!watch) return
    await this.run(deckId, async () => {
      this.stopWatch(deckId)
      await this.exportEdit(deckId, watch.file)
      if (!this.staged.has(deckId)) this.deps.library.discardEdit(deckId)
    })
  }

  /** Applies the pending version now, even while the deck is on air (the caller has confirmed). */
  async applyNow(deckId: string): Promise<void> {
    await this.run(deckId, async () => {
      if (!this.staged.has(deckId)) {
        throw new Error('There are no saved changes to apply. Save the file in PowerPoint first.')
      }
      await this.apply(deckId, true)
    })
  }

  /** Goes back to the imported file (`original.*`): export it again and replace the deck's files. */
  async revert(deckId: string): Promise<void> {
    await this.run(deckId, async () => {
      const original = this.deps.library.revertDeck(deckId)
      await this.stage(deckId, original, REVERT_FAILED)
      // The edit session is over: a later save of the old working copy must not undo the revert.
      this.stopWatch(deckId)
      this.deps.library.discardEdit(deckId)
    })
  }

  /** Call on every program state change: pending versions of decks that left air are applied. */
  async leftAir(): Promise<void> {
    for (const deckId of [...this.pendingSet]) {
      if (this.deps.isLive(deckId) || this.applying.has(deckId)) continue
      try {
        await this.apply(deckId, false)
      } catch {
        this.deps.onError(deckId, this.lastFailure.get(deckId) ?? EDIT_FAILED)
      }
    }
  }

  /** The deck was deleted: stop watching and drop what waits for it. */
  forget(deckId: string): void {
    this.stopWatch(deckId)
    this.dropStaged(deckId)
    this.pendingSet.delete(deckId)
  }

  dispose(): void {
    for (const deckId of [...this.watches.keys()]) this.stopWatch(deckId)
    for (const deckId of [...this.staged.keys()]) this.dropStaged(deckId)
    this.pendingSet.clear()
  }

  /** Runs one job at a time per deck. */
  private run<T>(deckId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(deckId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    const tail = next.catch(() => {})
    this.chains.set(deckId, tail)
    void tail.then(() => {
      if (this.chains.get(deckId) === tail) this.chains.delete(deckId)
    })
    return next
  }

  private schedule(deckId: string): void {
    const watch = this.watches.get(deckId)
    if (!watch) return
    if (watch.timer) clearTimeout(watch.timer)
    watch.timer = setTimeout(() => {
      watch.timer = null
      if (this.watches.get(deckId) !== watch) return
      this.run(deckId, () => this.exportEdit(deckId, watch.file)).catch((err) => {
        this.deps.onError(deckId, err instanceof Error ? err.message : EDIT_FAILED)
      })
    }, EDIT_DEBOUNCE_MS)
  }

  private stopWatch(deckId: string): void {
    const watch = this.watches.get(deckId)
    if (!watch) return
    this.watches.delete(deckId)
    if (watch.timer) clearTimeout(watch.timer)
    try {
      watch.close()
    } catch {
      /* already closed */
    }
  }

  /** Exports the saved working copy; a copy that equals the file in use cancels what waited. */
  private async exportEdit(deckId: string, file: string): Promise<void> {
    if (!this.deps.library.editChanged(deckId)) {
      this.dropStaged(deckId)
      this.setPending(deckId, false)
      return
    }
    await this.stage(deckId, file, EDIT_FAILED)
  }

  /** Exports a snapshot of `file` and applies it, or keeps it pending while the deck is live. */
  private async stage(deckId: string, file: string, failure: string): Promise<void> {
    const tmp = (this.deps.tempDir ?? defaultTempDir)()
    let imported: ImportedDeck
    try {
      // PowerPoint keeps the working copy open: export a copy of what was saved.
      const snap = path.join(tmp, 'snap', path.basename(file))
      fs.mkdirSync(path.dirname(snap), { recursive: true })
      fs.copyFileSync(file, snap)
      imported = await this.deps.exportDeck(snap, path.join(tmp, 'out'))
    } catch (err) {
      console.error('[editor] export failed:', err)
      fs.rmSync(tmp, { recursive: true, force: true })
      throw new Error(failure)
    }
    this.dropStaged(deckId)
    this.staged.set(deckId, { imported, tmp, failure })
    this.lastFailure.set(deckId, failure)
    if (this.deps.isLive(deckId)) this.setPending(deckId, true)
    else await this.apply(deckId, false)
  }

  /** Swaps the staged version in. Without `force` a deck that is on air stays pending. */
  private async apply(deckId: string, force: boolean): Promise<void> {
    if (!this.staged.has(deckId) || this.applying.has(deckId)) return
    this.applying.add(deckId)
    let failure: string | null = null
    try {
      await this.deps.suspend(deckId)
      if (!force && this.deps.isLive(deckId)) {
        this.setPending(deckId, true) // taken on air meanwhile
        return
      }
      const st = this.staged.get(deckId)
      if (!st) return
      this.staged.delete(deckId)
      try {
        this.deps.library.replaceDeckFiles(deckId, st.imported)
      } catch (err) {
        console.error('[editor] replace failed:', err)
        failure = st.failure
      }
      fs.rmSync(st.tmp, { recursive: true, force: true })
      // `pending: false` also tells the windows that the deck's files changed (images, clicks).
      const wasPending = this.pendingSet.has(deckId)
      this.setPending(deckId, false)
      if (!wasPending) this.deps.onPending(deckId, false)
      if (failure === null) {
        if (!this.watches.has(deckId)) this.deps.library.discardEdit(deckId)
        this.deps.applied(deckId)
      }
    } finally {
      this.applying.delete(deckId)
      this.deps.resume(deckId)
    }
    if (failure !== null) throw new Error(failure)
  }

  private dropStaged(deckId: string): void {
    const st = this.staged.get(deckId)
    if (!st) return
    this.staged.delete(deckId)
    fs.rmSync(st.tmp, { recursive: true, force: true })
  }

  private setPending(deckId: string, pending: boolean): void {
    if (this.pendingSet.has(deckId) === pending) return
    if (pending) this.pendingSet.add(deckId)
    else this.pendingSet.delete(deckId)
    this.deps.onPending(deckId, pending)
  }
}

function defaultTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-edit-'))
}
