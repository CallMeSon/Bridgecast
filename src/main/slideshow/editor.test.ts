import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Library } from '../library'
import type { ImportedDeck } from '../import/pptx'
import { DeckEditor, EDIT_FAILED, EDIT_DEBOUNCE_MS, type EditorDeps } from './editor'

let root: string
let tmp: string
let lib: Library
let deckId: string
let dir: string
let live: boolean
let exportDeck: ReturnType<typeof vi.fn>
let exportError: Error | null
let watchCb: (() => void) | null
let watchClosed: number
let events: string[]
let editor: DeckEditor
let openError: Error | null
let depsOver: Partial<EditorDeps>
let locked: boolean

const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf8')

/** Fake PowerPoint export: the PNG carries the text of the file it exported. */
function fakeExport(file: string, out: string): Promise<ImportedDeck> {
  if (exportError) return Promise.reject(exportError)
  fs.mkdirSync(out, { recursive: true })
  const text = fs.readFileSync(file, 'utf8')
  const png = path.join(out, '001.png')
  const pdf = path.join(out, 'x.pdf')
  fs.writeFileSync(png, `png:${text}`)
  fs.writeFileSync(pdf, `pdf:${text}`)
  return Promise.resolve({
    name: 'edit',
    width: 1920,
    height: 1080,
    slides: [{ pngPath: png, notes: text, clicks: 1, hidden: false }],
    pdfPath: pdf,
    isStatic: false,
    sourcePath: file
  })
}

function make(): void {
  editor = new DeckEditor({
    library: lib,
    exportDeck: exportDeck as unknown as EditorDeps['exportDeck'],
    openInPowerPoint: async (file) => {
      events.push(`open:${path.basename(file)}`)
      if (openError) throw openError
    },
    isLive: () => live,
    suspend: async (id) => {
      events.push(`suspend:${id === deckId ? 'deck' : id}`)
    },
    resume: () => events.push('resume'),
    applied: () => events.push('applied'),
    onPending: (_id, pending) => events.push(`pending:${pending}`),
    onError: (_id, message) => events.push(`error:${message}`),
    watch: (_file, cb) => {
      watchCb = cb
      return () => {
        watchClosed++
        watchCb = null
      }
    },
    tempDir: () => fs.mkdtempSync(path.join(tmp, 'job-')),
    ...depsOver
  })
}

/** The operator saves in PowerPoint: the file changes and the watcher fires. */
async function save(text: string): Promise<void> {
  fs.writeFileSync(path.join(dir, 'edit.pptx'), text)
  watchCb?.()
}

const settle = async (ms = EDIT_DEBOUNCE_MS): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-root-'))
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-tmp-'))
  const srcDir = fs.mkdtempSync(path.join(tmp, 'src-'))
  const png = path.join(srcDir, 'a.png')
  const sourcePath = path.join(srcDir, 'deck.pptx')
  fs.writeFileSync(png, 'png:ORIG')
  fs.writeFileSync(sourcePath, 'ORIG')
  locked = false
  lib = new Library(
    root,
    () => {
      throw new Error('no thumbs')
    },
    (file) => {
      if (locked && /edit\.pptx$/.test(file)) throw new Error('EBUSY')
      fs.rmSync(file, { force: true })
    }
  )
  const ev = lib.createEvent('E')
  const deck = lib.addDeck(ev.id, {
    name: 'Keynote',
    source: 'pptx',
    width: 1920,
    height: 1080,
    slides: [{ pngPath: png, notes: 'old' }],
    sourcePath,
    playback: 'native'
  })
  deckId = deck.id
  dir = path.join(root, 'decks', deckId)
  live = false
  exportError = null
  openError = null
  watchCb = null
  watchClosed = 0
  events = []
  depsOver = {}
  exportDeck = vi.fn(fakeExport)
  make()
})

afterEach(() => {
  editor.dispose()
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('DeckEditor', () => {
  it('edit copies source to edit.pptx, opens it and starts watching', async () => {
    await editor.edit(deckId)
    expect(read('edit.pptx')).toBe('ORIG')
    expect(events).toEqual(['open:edit.pptx'])
    expect(watchCb).not.toBeNull()
  })

  it('a deck that is not a PowerPoint deck cannot be edited', async () => {
    const ev = lib.listEvents()[0]
    const pdf = lib.addDeck(ev.id, {
      name: 'P',
      source: 'pdf',
      width: 1,
      height: 1,
      slides: [{ pngPath: path.join(dir, 'source.pptx'), notes: '' }]
    })
    await expect(editor.edit(pdf.id)).rejects.toThrow(/PowerPoint deck/)
  })

  it('a save while the deck is off air replaces the files after the debounce', async () => {
    await editor.edit(deckId)
    await save('V2')
    await settle(EDIT_DEBOUNCE_MS - 1)
    expect(exportDeck).not.toHaveBeenCalled()
    await settle(1)
    expect(exportDeck).toHaveBeenCalledTimes(1)
    expect(read('source.pptx')).toBe('V2')
    expect(read('001.png')).toBe('png:V2')
    expect(read('source.pdf')).toBe('pdf:V2')
    expect(read('original.pptx')).toBe('ORIG')
    expect(lib.getDeck(deckId).slides[0].notes).toBe('V2')
    expect(editor.pending(deckId)).toBe(false)
    expect(events).toEqual(['open:edit.pptx', 'suspend:deck', 'applied', 'resume'])
    // The working copy stays while the operator keeps editing.
    expect(fs.existsSync(path.join(dir, 'edit.pptx'))).toBe(true)
  })

  it('several saves inside the debounce export once, the last one', async () => {
    await editor.edit(deckId)
    await save('V2')
    await settle(600)
    await save('V3')
    await settle(600)
    expect(exportDeck).not.toHaveBeenCalled()
    await settle(400)
    expect(exportDeck).toHaveBeenCalledTimes(1)
    expect(read('source.pptx')).toBe('V3')
  })

  it('the export reads a snapshot, not the file PowerPoint holds open', async () => {
    await editor.edit(deckId)
    await save('V2')
    await settle()
    const [file] = exportDeck.mock.calls[0] as [string]
    expect(file).not.toBe(path.join(dir, 'edit.pptx'))
    expect(path.basename(file)).toBe('edit.pptx')
  })

  it('a save with no change to the file exports nothing', async () => {
    await editor.edit(deckId)
    watchCb?.()
    await settle()
    expect(exportDeck).not.toHaveBeenCalled()
  })

  it('a save while the deck is live becomes pending and nothing is replaced', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    expect(exportDeck).toHaveBeenCalledTimes(1)
    expect(editor.pending(deckId)).toBe(true)
    expect(events).toContain('pending:true')
    expect(events).not.toContain('suspend:deck')
    expect(read('source.pptx')).toBe('ORIG')
    expect(read('001.png')).toBe('png:ORIG')
    expect(lib.getDeck(deckId).slides[0].notes).toBe('old')
  })

  it('a pending edit is applied when the deck leaves air', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    await editor.leftAir() // still live: nothing happens
    expect(read('source.pptx')).toBe('ORIG')
    live = false
    await editor.leftAir()
    expect(read('source.pptx')).toBe('V2')
    expect(read('001.png')).toBe('png:V2')
    expect(editor.pending(deckId)).toBe(false)
    expect(events.filter((e) => e.startsWith('pending'))).toEqual(['pending:true', 'pending:false'])
    expect(events.slice(-4)).toEqual(['suspend:deck', 'pending:false', 'applied', 'resume'])
  })

  it('a later save while pending replaces the pending version', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    await save('V3')
    await settle()
    live = false
    await editor.leftAir()
    expect(read('source.pptx')).toBe('V3')
    expect(events.filter((e) => e === 'pending:true')).toHaveLength(1)
  })

  it('applyNow replaces the files even while the deck is live', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    await editor.applyNow(deckId)
    expect(read('source.pptx')).toBe('V2')
    expect(editor.pending(deckId)).toBe(false)
    expect(events.slice(-4)).toEqual(['suspend:deck', 'pending:false', 'applied', 'resume'])
  })

  it('applyNow without a pending edit says so', async () => {
    await expect(editor.applyNow(deckId)).rejects.toThrow(/no saved changes/i)
  })

  it('a deck taken on air while its slide show closes stays pending', async () => {
    let calls = 0
    depsOver = {
      suspend: async () => {
        events.push('suspend')
        if (calls++ === 0) live = true // taken on air during the close
      }
    }
    make()
    await editor.edit(deckId)
    await save('V2')
    await settle()
    expect(read('source.pptx')).toBe('ORIG')
    expect(editor.pending(deckId)).toBe(true)
    expect(events).toContain('pending:true')
    expect(events.at(-1)).toBe('resume')
    live = false
    await editor.leftAir()
    expect(read('source.pptx')).toBe('V2')
    expect(editor.pending(deckId)).toBe(false)
  })

  it('a failing export keeps the old files and reports the copy', async () => {
    await editor.edit(deckId)
    exportError = new Error('PowerPoint is busy')
    await save('V2')
    await settle()
    expect(events).toContain(`error:${EDIT_FAILED}`)
    expect(EDIT_FAILED).toBe(
      'Your changes could not be loaded. The previous version is still used. Save the file again in PowerPoint.'
    )
    expect(editor.pending(deckId)).toBe(false)
    expect(read('source.pptx')).toBe('ORIG')
    expect(read('001.png')).toBe('png:ORIG')
    expect(lib.getDeck(deckId).slides[0].notes).toBe('old')
    // Saving again after fixing the problem works.
    exportError = null
    await save('V3')
    await settle()
    expect(read('source.pptx')).toBe('V3')
  })

  it('a failing export while pending keeps the pending version', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    exportError = new Error('boom')
    await save('V3')
    await settle()
    expect(editor.pending(deckId)).toBe(true)
    live = false
    exportError = null
    await editor.leftAir()
    expect(read('source.pptx')).toBe('V2')
  })

  it('a failing replace keeps the old files and reports the copy', async () => {
    await editor.edit(deckId)
    depsOver = {}
    const spy = vi.spyOn(lib, 'replaceDeckFiles').mockImplementation(() => {
      throw new Error('disk full')
    })
    await save('V2')
    await settle()
    spy.mockRestore()
    expect(events).toContain(`error:${EDIT_FAILED}`)
    expect(read('source.pptx')).toBe('ORIG')
    expect(editor.pending(deckId)).toBe(false)
    expect(events).toContain('resume')
  })

  it('done stops watching, exports at once and throws the copy when it fails', async () => {
    await editor.edit(deckId)
    fs.writeFileSync(path.join(dir, 'edit.pptx'), 'V2')
    await editor.done(deckId)
    expect(watchClosed).toBe(1)
    expect(read('source.pptx')).toBe('V2')
    // The working copy is removed when nothing is pending and the watcher is gone.
    expect(fs.existsSync(path.join(dir, 'edit.pptx'))).toBe(false)

    await editor.edit(deckId)
    exportError = new Error('x')
    fs.writeFileSync(path.join(dir, 'edit.pptx'), 'V3')
    await expect(editor.done(deckId)).rejects.toThrow(EDIT_FAILED)
    expect(read('source.pptx')).toBe('V2')
  })

  it('done with the deck live leaves the edit pending and keeps the working copy', async () => {
    live = true
    await editor.edit(deckId)
    fs.writeFileSync(path.join(dir, 'edit.pptx'), 'V2')
    await editor.done(deckId)
    expect(editor.pending(deckId)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'edit.pptx'))).toBe(true)
    live = false
    await editor.leftAir()
    expect(read('source.pptx')).toBe('V2')
    expect(fs.existsSync(path.join(dir, 'edit.pptx'))).toBe(false)
  })

  it('a save after done is ignored', async () => {
    await editor.edit(deckId)
    await editor.done(deckId)
    expect(watchCb).toBeNull()
    expect(exportDeck).not.toHaveBeenCalled()
  })

  it('edit again while already editing opens the same working copy and keeps one watcher', async () => {
    await editor.edit(deckId)
    await editor.edit(deckId)
    expect(events.filter((e) => e === 'open:edit.pptx')).toHaveLength(2)
    expect(watchClosed).toBe(0)
  })

  it('a PowerPoint that cannot open the copy ends the edit session', async () => {
    openError = new Error('PowerPoint could not open the file.')
    await expect(editor.edit(deckId)).rejects.toThrow('PowerPoint could not open the file.')
    expect(watchClosed).toBe(1)
    expect(fs.existsSync(path.join(dir, 'edit.pptx'))).toBe(false)
  })

  it('forget and dispose stop watching and drop pending versions', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    expect(editor.pending(deckId)).toBe(true)
    editor.forget(deckId)
    expect(watchClosed).toBe(1)
    expect(editor.pending(deckId)).toBe(false)
    const left = fs.readdirSync(tmp).filter((f) => f.startsWith('job-'))
    expect(left).toEqual([])
  })

  it('dispose removes the temporary files of a pending version', async () => {
    live = true
    await editor.edit(deckId)
    await save('V2')
    await settle()
    editor.dispose()
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith('job-'))).toEqual([])
    expect(watchClosed).toBe(1)
  })

  describe('revert', () => {
    async function edited(): Promise<void> {
      await editor.edit(deckId)
      await save('V2')
      await settle()
      events.length = 0
    }

    it('a deck that was never edited cannot be reverted', async () => {
      await expect(editor.revert(deckId)).rejects.toThrow(/not been edited/)
    })

    it('puts the imported file back, keeping the deck name and ends the edit session', async () => {
      await edited()
      expect(lib.isEdited(deckId)).toBe(true)
      await editor.revert(deckId)
      expect(read('source.pptx')).toBe('ORIG')
      expect(read('001.png')).toBe('png:ORIG')
      expect(read('original.pptx')).toBe('ORIG')
      expect(lib.isEdited(deckId)).toBe(false)
      expect(lib.getDeck(deckId).name).toBe('Keynote')
      expect(watchClosed).toBe(1)
      expect(fs.existsSync(path.join(dir, 'edit.pptx'))).toBe(false)
    })

    it('while live it is pending and applies when the deck leaves air', async () => {
      await edited()
      live = true
      await editor.revert(deckId)
      expect(editor.pending(deckId)).toBe(true)
      expect(read('source.pptx')).toBe('V2')
      live = false
      await editor.leftAir()
      expect(read('source.pptx')).toBe('ORIG')
      expect(editor.pending(deckId)).toBe(false)
    })

    it('the old window still open: the next edit does not bring the reverted edits back', async () => {
      await edited()
      locked = true // PowerPoint keeps edit.pptx open, the delete fails
      await editor.revert(deckId)
      expect(read('source.pptx')).toBe('ORIG')
      expect(read('edit.pptx')).toBe('V2')
      await editor.edit(deckId)
      expect(read('edit.pptx')).toBe('ORIG')
      expect(lib.editChanged(deckId)).toBe(false)
    })

    it('a failing export keeps the edited version', async () => {
      await edited()
      exportError = new Error('x')
      await expect(editor.revert(deckId)).rejects.toThrow(/could not be restored/)
      expect(read('source.pptx')).toBe('V2')
      expect(lib.isEdited(deckId)).toBe(true)
    })
  })
})
