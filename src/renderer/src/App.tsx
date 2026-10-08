import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckMeta, EventMeta } from '../../shared/types'
import { initialState, type Action, type ProgramState } from '../../shared/program'
import type { ImportRequest } from '../../shared/ipc'
import { Header } from './components/Header'
import { Library, type ImportRow } from './components/Library'
import { DropOverlay } from './components/DropOverlay'
import { Program } from './components/Program'
import { Controls } from './components/Controls'
import { NextPanel } from './components/NextPanel'
import { Strip } from './components/Strip'
import {
  baseName,
  canNext,
  canPrev,
  currentDeck,
  errorMessage,
  fileKind,
  keyToAction,
  moveItem,
  moveOrder,
  tally,
  UNSUPPORTED
} from './model'
import { applyTheme, loadTheme, type Theme } from './theme'
import { renderPdf } from './import/pdf'

const IMPORT_WIDTH = 1920
let importSeq = 0
const newImportId = (): string => `imp-${Date.now()}-${importSeq++}`

function App(): React.JSX.Element {
  const api = window.api
  const [events, setEvents] = useState<EventMeta[]>([])
  const [eventId, setEventId] = useState<string | null>(null)
  const [decks, setDecks] = useState<DeckMeta[]>([])
  const [program, setProgram] = useState<ProgramState>(initialState)
  const [imports, setImports] = useState<ImportRow[]>([])
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const eventRef = useRef<string | null>(null)

  const upsertImport = useCallback((p: ImportRow) => {
    setImports((xs) => {
      if (p.status === 'done') return xs.filter((x) => x.id !== p.id)
      const i = xs.findIndex((x) => x.id === p.id)
      if (i < 0) return [...xs, p]
      const next = [...xs]
      next[i] = p
      return next
    })
  }, [])

  const reportError = useCallback(
    (name: string, err: unknown) =>
      upsertImport({
        id: newImportId(),
        name,
        percent: 100,
        status: 'error',
        message: errorMessage(err)
      }),
    [upsertImport]
  )

  const reloadDecks = useCallback(
    async (id: string | null) => {
      const list = id ? await api.listDecks(id) : []
      if (eventRef.current === id) setDecks(list)
    },
    [api]
  )

  // Initial load and main-process subscriptions.
  useEffect(() => {
    const offState = api.onProgramState(setProgram)
    const offProgress = api.onImportProgress((p) => {
      upsertImport(p)
      if (p.status === 'done') reloadDecks(eventRef.current).catch((e) => reportError(p.name, e))
    })
    ;(async () => {
      const [session, evs] = await Promise.all([api.getSession(), api.listEvents()])
      eventRef.current = session.eventId
      setEvents(evs)
      setEventId(session.eventId)
      setProgram(session.state)
      await reloadDecks(session.eventId)
    })().catch((e) => reportError('Library', e))
    return () => {
      offState()
      offProgress()
    }
  }, [api, upsertImport, reloadDecks, reportError])

  const dispatch = useCallback(
    (a: Action) => {
      api.dispatch(a).then(setProgram, (e) => reportError('Program', e))
    },
    [api, reportError]
  )

  // Keyboard shortcuts (ignored while typing in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = keyToAction(e)
      if (!a) return
      e.preventDefault()
      dispatch(a)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [dispatch])

  const selectEvent = useCallback(
    async (id: string) => {
      try {
        eventRef.current = id
        setEventId(id)
        setImports((xs) => xs.filter((x) => x.status === 'busy'))
        const list = await api.listDecks(id)
        const s = await api.selectEvent(id)
        if (eventRef.current === id) setDecks(list)
        setProgram(s)
      } catch (e) {
        reportError('Event', e)
      }
    },
    [api, reportError]
  )

  const createEvent = useCallback(
    async (name: string) => {
      try {
        const ev = await api.createEvent(name)
        setEvents(await api.listEvents())
        await selectEvent(ev.id)
      } catch (e) {
        reportError(name, e)
      }
    },
    [api, selectEvent, reportError]
  )

  // PDFs render here (pdf.js) one at a time, so several dropped PDFs never
  // compete for the renderer; PPT/PPTX go to main's import queue.
  const pdfChain = useRef<Promise<void>>(Promise.resolve())

  const importPdf = useCallback(
    async (target: string, id: string, f: File) => {
      const name = f.name
      try {
        upsertImport({ id, name, percent: 5, status: 'busy' })
        const data = new Uint8Array(await f.arrayBuffer())
        const r = await renderPdf(data, IMPORT_WIDTH, (done, total) =>
          upsertImport({ id, name, percent: 5 + Math.round((85 * done) / total), status: 'busy' })
        )
        upsertImport({ id, name, percent: 95, status: 'busy' })
        await api.addRendered(target, {
          name: baseName(f.name),
          width: r.width,
          height: r.height,
          pages: r.pages
        })
        upsertImport({ id, name, percent: 100, status: 'done' })
        await reloadDecks(target)
      } catch (e) {
        upsertImport({ id, name, percent: 100, status: 'error', message: errorMessage(e) })
      }
    },
    [api, upsertImport, reloadDecks]
  )

  /**
   * One path for the "Tambah file" dialog and drag and drop: imports into the
   * active event. Unsupported files and folders become error rows at once.
   */
  const importFiles = useCallback(
    (files: File[], folders: string[] = []) => {
      const target = eventRef.current
      const unsupported = (name: string, message: string): void =>
        upsertImport({
          id: newImportId(),
          name,
          percent: 100,
          status: 'error',
          meta: UNSUPPORTED.meta,
          message
        })
      for (const name of folders) unsupported(name, UNSUPPORTED.folder)
      if (!target) {
        for (const f of files) {
          reportError(
            f.name,
            new Error('Belum ada event. Buat event lewat menu event, lalu impor lagi.')
          )
        }
        return
      }
      const pptx: ImportRequest[] = []
      for (const f of files) {
        const kind = fileKind(f.name)
        if (kind === 'unsupported') {
          unsupported(f.name, UNSUPPORTED.file)
          continue
        }
        const id = newImportId()
        // Queued row right away, so every dropped file is visible while it waits.
        upsertImport({ id, name: f.name, percent: 0, status: 'busy' })
        if (kind === 'pdf') {
          pdfChain.current = pdfChain.current.then(() => importPdf(target, id, f))
          continue
        }
        const p = api.pathForFile(f)
        if (!p) {
          upsertImport({
            id,
            name: f.name,
            percent: 100,
            status: 'error',
            message: 'Lokasi file tidak diketahui. Simpan file ke disk, lalu seret dari Explorer.'
          })
          continue
        }
        pptx.push({ id, path: p })
      }
      if (pptx.length) {
        api.importDecks(target, pptx).catch((e) => {
          for (const r of pptx) {
            upsertImport({
              id: r.id,
              name: r.path.split(/[\\/]/).pop() || 'PowerPoint',
              percent: 100,
              status: 'error',
              message: errorMessage(e)
            })
          }
        })
      }
    },
    [api, upsertImport, reportError, importPdf]
  )

  // Reorder and delete: the list moves at once (optimistic), main persists it,
  // then the authoritative list is reloaded. Program follows via program:state.
  const moveDeck = useCallback(
    (from: number, to: number) => {
      const target = eventRef.current
      if (!target || from === to) return
      const next = moveItem(decks, from, to)
      setDecks(next)
      api
        .reorderDecks(
          target,
          next.map((d) => d.id)
        )
        .catch((e) => reportError('Urutan deck', e))
        .finally(() => reloadDecks(target).catch((e) => reportError('Library', e)))
    },
    [api, decks, reloadDecks, reportError]
  )

  // Rename: main validates and saves; errors are shown in the row by Library.
  const renameDeck = useCallback(
    async (deckId: string, name: string) => {
      const target = eventRef.current
      if (!target) return
      await api.renameDeck(target, deckId, name)
      await reloadDecks(target)
    },
    [api, reloadDecks]
  )

  const moveSlide = useCallback(
    (deckId: string, from: number, to: number) => {
      const target = eventRef.current
      const deck = decks.find((d) => d.id === deckId)
      if (!target || !deck || from === to) return
      const order = moveOrder(deck.slides.length, from, to)
      setDecks((ds) =>
        ds.map((d) => (d.id === deckId ? { ...d, slides: order.map((i) => d.slides[i]) } : d))
      )
      api
        .reorderSlides(deckId, order)
        .catch((e) => reportError('Urutan slide', e))
        .finally(() => reloadDecks(target).catch((e) => reportError('Library', e)))
    },
    [api, decks, reloadDecks, reportError]
  )

  const removeDeck = useCallback(
    (deckId: string) => {
      const target = eventRef.current
      if (!target) return
      const name = decks.find((d) => d.id === deckId)?.name ?? 'Deck'
      // Drop it from the list first so nothing requests its images any more.
      setDecks((ds) => ds.filter((d) => d.id !== deckId))
      api
        .removeDeck(target, deckId)
        .catch((e) => reportError(name, e))
        .finally(() => reloadDecks(target).catch((e) => reportError('Library', e)))
    },
    [api, decks, reloadDecks, reportError]
  )

  const chooseTheme = (t: Theme): void => {
    applyTheme(t)
    setTheme(t)
  }

  const deck = currentDeck(decks, program)
  const ready = deck !== null

  return (
    <div className="app">
      <Header
        events={events}
        eventId={eventId}
        onSelectEvent={selectEvent}
        onCreateEvent={createEvent}
        theme={theme}
        onSetTheme={chooseTheme}
      />
      <main>
        <Library
          decks={decks}
          imports={imports}
          currentDeckId={ready ? program.deckId : null}
          live={tally(program) === 'live' ? program.shown : null}
          canImport={eventId !== null}
          onSelectDeck={(deckId) => dispatch({ type: 'selectDeck', deckId })}
          onDismissImport={(id) => setImports((xs) => xs.filter((x) => x.id !== id))}
          onFiles={importFiles}
          onMoveDeck={moveDeck}
          onRemoveDeck={removeDeck}
          onRenameDeck={renameDeck}
        />
        <section className="stage-col" aria-label="Program">
          <Program state={program} deck={deck} />
          <Controls
            state={program}
            canPrev={canPrev(decks, program)}
            canNext={canNext(decks, program)}
            onAction={dispatch}
          />
        </section>
        <NextPanel decks={decks} state={program} onAction={dispatch} />
      </main>
      <Strip
        decks={decks}
        state={program}
        onGoto={(index) => dispatch({ type: 'goto', index })}
        onMoveSlide={moveSlide}
      />
      <DropOverlay onDrop={({ files, folders }) => importFiles(files, folders)} />
    </div>
  )
}

export default App
