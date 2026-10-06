import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckMeta, EventMeta } from '../../shared/types'
import { initialState, type Action, type ProgramState } from '../../shared/program'
import type { ImportProgress, ImportRequest } from '../../shared/ipc'
import { Header } from './components/Header'
import { Library } from './components/Library'
import { Program } from './components/Program'
import { Controls } from './components/Controls'
import { NextPanel } from './components/NextPanel'
import { Strip } from './components/Strip'
import { baseName, canPrev, currentDeck, errorMessage, fileKind, keyToAction } from './model'
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
  const [imports, setImports] = useState<ImportProgress[]>([])
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const eventRef = useRef<string | null>(null)

  const upsertImport = useCallback((p: ImportProgress) => {
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

  const importFiles = useCallback(
    (files: File[]) => {
      const target = eventRef.current
      if (!target) return
      const pptx: ImportRequest[] = []
      const pdfs: File[] = []
      for (const f of files) {
        const kind = fileKind(f.name)
        if (kind === 'pptx') pptx.push({ id: newImportId(), path: api.pathForFile(f) })
        else if (kind === 'pdf') pdfs.push(f)
        else
          reportError(
            f.name,
            new Error('Format file tidak didukung. Pilih file PPTX, PPT, atau PDF.')
          )
      }
      if (pptx.length) api.importDecks(target, pptx).catch((e) => reportError('PowerPoint', e))

      // PDFs are rendered here with pdf.js, then handed to main as PNG buffers.
      ;(async () => {
        for (const f of pdfs) {
          const id = newImportId()
          const name = f.name
          upsertImport({ id, name, percent: 15, status: 'busy' })
          try {
            const data = new Uint8Array(await f.arrayBuffer())
            upsertImport({ id, name, percent: 40, status: 'busy' })
            const r = await renderPdf(data, IMPORT_WIDTH)
            upsertImport({ id, name, percent: 85, status: 'busy' })
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
        }
      })()
    },
    [api, upsertImport, reloadDecks, reportError]
  )

  const toggleTheme = (): void => {
    const t = theme === 'dark' ? 'light' : 'dark'
    applyTheme(t)
    setTheme(t)
  }

  const ready = currentDeck(decks, program) !== null

  return (
    <div className="app">
      <Header
        events={events}
        eventId={eventId}
        onSelectEvent={selectEvent}
        onCreateEvent={createEvent}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main>
        <Library
          decks={decks}
          imports={imports}
          currentDeckId={ready ? program.deckId : null}
          canImport={eventId !== null}
          onSelectDeck={(deckId) => dispatch({ type: 'selectDeck', deckId })}
          onDismissImport={(id) => setImports((xs) => xs.filter((x) => x.id !== id))}
          onFiles={importFiles}
        />
        <section className="stage-col">
          <Program state={program} />
          <Controls
            state={program}
            canPrev={canPrev(decks, program)}
            canNext={ready}
            onAction={dispatch}
          />
        </section>
        <NextPanel decks={decks} state={program} />
      </main>
      <Strip decks={decks} state={program} onGoto={(index) => dispatch({ type: 'goto', index })} />
    </div>
  )
}

export default App
