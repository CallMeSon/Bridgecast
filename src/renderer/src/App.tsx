import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeckMeta, EventMeta, SectionMeta } from '../../shared/types'
import { orderItems, splitOrder } from '../../shared/sections'
import { initialState, kvOnAir, reduce, type Action, type ProgramState } from '../../shared/program'
import type { ImportRequest } from '../../shared/ipc'
import type { DeckFit } from '../../shared/canvas'
import type { DeckAudio } from '../../shared/audio-levels'
import { Header } from './components/Header'
import { Library, type ImportRow } from './components/Library'
import { DropOverlay } from './components/DropOverlay'
import { Program } from './components/Program'
import { Controls } from './components/Controls'
import { NextPanel } from './components/NextPanel'
import { Strip } from './components/Strip'
import { Splitters } from './components/Splitters'
import { ActionError, SaveNote } from './components/ActionError'
import { CaptureWarning } from './components/CaptureWarning'
import { WebPrecapture } from './components/WebPrecapture'
import { useWebOutputs, useWebPages } from './web-pages'
import type { StreamOptions } from './components/SlideLayers'
import type { WebCaptureWarning } from '../../shared/web'
import { capturesForGate, precaptureIds } from './stream'
import {
  baseName,
  canNext,
  canNextSection,
  canPrev,
  canPrevSection,
  currentDeck,
  errorMessage,
  fileKind,
  keyToAction,
  moveItem,
  moveOrder,
  outputSource,
  SAVED,
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
  // The event the loaded `decks` belong to. Sections follow this, not `eventId`, so
  // decks and sections never come from two different events while a switch loads.
  const [decksEventId, setDecksEventId] = useState<string | null>(null)
  const [program, setProgram] = useState<ProgramState>(initialState)
  const [imports, setImports] = useState<ImportRow[]>([])
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const sections = useMemo<SectionMeta[]>(
    () => events.find((e) => e.id === decksEventId)?.sections ?? [],
    [events, decksEventId]
  )
  const eventRef = useRef<string | null>(null)
  const appRef = useRef<HTMLDivElement>(null)
  // A failed Program action (shown next to the tally) and a short "saved" note.
  const [actionError, setActionError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const announce = useCallback((text: string) => {
    clearTimeout(noteTimer.current)
    setNote(text)
    noteTimer.current = setTimeout(() => setNote(''), 3000)
  }, [])
  useEffect(() => () => clearTimeout(noteTimer.current), [])

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
      if (eventRef.current === id) {
        setDecks(list)
        setDecksEventId(id)
      }
    },
    [api]
  )

  /** Authoritative decks and events (sections live on the event) after a failed or finished change. */
  const reloadAll = useCallback(
    async (id: string) => {
      try {
        const [list, evs] = await Promise.all([api.listDecks(id), api.listEvents()])
        if (eventRef.current === id) {
          setDecks(list)
          setDecksEventId(id)
        }
        setEvents(evs)
      } catch (e) {
        reportError('Decks', e)
      }
    },
    [api, reportError]
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
    })().catch((e) => reportError('Decks', e))
    return () => {
      offState()
      offProgress()
    }
  }, [api, upsertImport, reloadDecks, reportError])

  const dispatch = useCallback(
    (a: Action) => {
      api.dispatch(a).then(
        (s) => {
          setProgram(s)
          setActionError(null)
        },
        (e) => setActionError(errorMessage(e))
      )
    },
    [api]
  )
  const goto = useCallback((index: number) => dispatch({ type: 'goto', index }), [dispatch])

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
        if (eventRef.current === id) {
          setDecks(list)
          setDecksEventId(id)
        }
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
   * One path for the "Add files" dialog and drag and drop: imports into the
   * active event. Unsupported files become error rows at once; a dropped folder
   * (page-NN.png / page-NN.mp4) goes to main's import queue like a PPTX.
   */
  const importFiles = useCallback(
    (files: File[], folders: File[] = []) => {
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
      if (!target) {
        for (const f of [...folders, ...files]) {
          reportError(
            f.name,
            new Error('No event yet. Create one from the Event menu, then import again.')
          )
        }
        return
      }
      const pptx: ImportRequest[] = []
      /** Main-queue import (PPTX or folder): needs the item's path on disk. */
      const queueForMain = (f: File, id: string, missing: string): void => {
        const p = api.pathForFile(f)
        if (!p) {
          upsertImport({
            id,
            name: f.name,
            percent: 100,
            status: 'error',
            message: missing
          })
          return
        }
        pptx.push({ id, path: p })
      }
      for (const f of folders) {
        const id = newImportId()
        upsertImport({ id, name: f.name, percent: 0, status: 'busy' })
        queueForMain(
          f,
          id,
          'Could not find the folder location. Drag the folder in from File Explorer, then try again.'
        )
      }
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
        queueForMain(
          f,
          id,
          'Could not find the file location. Save the file to disk, then drag it in from File Explorer.'
        )
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
  // Indices are into the ordered list of decks and sections.
  const moveListItem = useCallback(
    (from: number, to: number) => {
      const target = eventRef.current
      if (!target || from === to) return
      const items = moveItem(
        orderItems(
          decks.map((d) => d.id),
          sections
        ),
        from,
        to
      )
      const split = splitOrder(items, sections)
      const byId = new Map(decks.map((d) => [d.id, d]))
      setDecks(split.deckIds.flatMap((id) => byId.get(id) ?? []))
      setEvents((xs) => xs.map((x) => (x.id === target ? { ...x, sections: split.sections } : x)))
      api
        .reorderDecks(target, items)
        .then(
          () => announce(SAVED.order),
          (e) => reportError('Deck order', e)
        )
        .finally(() => void reloadAll(target))
    },
    [api, decks, sections, announce, reloadAll, reportError]
  )

  // Sections: main validates and saves; the event it returns replaces ours.
  const replaceEvent = useCallback(
    (ev: EventMeta) => setEvents((xs) => xs.map((x) => (x.id === ev.id ? ev : x))),
    []
  )
  const addSection = useCallback(
    async (at: number | 'end'): Promise<string | null> => {
      const target = eventRef.current
      if (!target) return null
      try {
        const r = await api.addSection(target, at)
        replaceEvent(r.event)
        return r.sectionId
      } catch (e) {
        reportError('Section', e)
        return null
      }
    },
    [api, replaceEvent, reportError]
  )
  const renameSection = useCallback(
    async (sectionId: string, name: string) => {
      const target = eventRef.current
      if (!target) throw new Error('Choose an event first, then rename the section.')
      replaceEvent(await api.renameSection(target, sectionId, name))
    },
    [api, replaceEvent]
  )
  const removeSection = useCallback(
    (sectionId: string) => {
      const target = eventRef.current
      if (!target) return
      api.removeSection(target, sectionId).then(replaceEvent, (e) => {
        reportError('Section', e)
        void reloadAll(target)
      })
    },
    [api, replaceEvent, reloadAll, reportError]
  )

  // Rename: main validates and saves; errors are shown in the row by Library.
  const renameDeck = useCallback(
    async (deckId: string, name: string) => {
      const target = eventRef.current
      if (!target) throw new Error('Choose an event first, then rename the deck.')
      await api.renameDeck(target, deckId, name)
      await reloadDecks(target)
    },
    [api, reloadDecks]
  )

  /**
   * Keep the fit and sound main answers with, and nothing else of the deck: a slide
   * reorder that is still on its way must not be undone by this older copy.
   */
  const applyDeckLevels = useCallback((meta: DeckMeta) => {
    setDecks((ds) =>
      ds.map((d) => (d.id === meta.id ? { ...d, fit: meta.fit, audio: meta.audio } : d))
    )
  }, [])

  // Fit and sound change what the audience sees and hears at once (Program does not
  // replay); a refusal is shown in the list and the saved values are read back.
  const setDeckFit = useCallback(
    (deckId: string, fit: DeckFit) => {
      const target = eventRef.current
      if (!target) return
      api.setDeckFit(target, deckId, fit).then(applyDeckLevels, (e) => {
        reportError('Display mode', e)
        reloadDecks(target).catch((err) => reportError('Decks', err))
      })
    },
    [api, applyDeckLevels, reloadDecks, reportError]
  )

  const setDeckAudio = useCallback(
    (deckId: string, audio: DeckAudio) => {
      const target = eventRef.current
      if (!target) return
      api.setDeckAudio(target, deckId, audio).then(applyDeckLevels, (e) => {
        reportError('Deck sound', e)
        reloadDecks(target).catch((err) => reportError('Decks', err))
      })
    },
    [api, applyDeckLevels, reloadDecks, reportError]
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
        .then(
          () => announce(SAVED.order),
          (e) => reportError('Slide order', e)
        )
        .finally(() => reloadDecks(target).catch((e) => reportError('Decks', e)))
    },
    [api, decks, announce, reloadDecks, reportError]
  )

  const removeDeck = useCallback(
    (deckId: string) => {
      const target = eventRef.current
      if (!target) return
      const name = decks.find((d) => d.id === deckId)?.name ?? 'Deck'
      // Drop it from the list first so nothing requests its images any more. Sections
      // after it shift with the decks, so list and sections never disagree.
      setDecks((ds) => ds.filter((d) => d.id !== deckId))
      const rest = splitOrder(
        orderItems(
          decks.map((d) => d.id),
          sections
        ).filter((item) => !('deck' in item && item.deck === deckId)),
        sections
      )
      setEvents((xs) => xs.map((x) => (x.id === target ? { ...x, sections: rest.sections } : x)))
      api
        .removeDeck(target, deckId)
        .catch((e) => reportError(name, e))
        // Removing a deck shifts the sections after it, so events are reloaded too.
        .finally(() => void reloadAll(target))
    },
    [api, decks, sections, reloadAll, reportError]
  )

  // KV image of the active event. Main validates the path and the image; the
  // program state (kvUrl) follows via program:state, the event list is kept in step.
  const setKv = useCallback(
    async (file: File) => {
      const target = eventRef.current
      if (!target) throw new Error('Choose an event first, then choose the KV image.')
      const p = api.pathForFile(file)
      if (!p) {
        throw new Error('Could not find the file location. Choose a KV image from disk.')
      }
      const ev = await api.setKv(target, p)
      setEvents((xs) => xs.map((x) => (x.id === ev.id ? ev : x)))
      announce(SAVED.kv)
    },
    [api, announce]
  )

  const clearKv = useCallback(async () => {
    const target = eventRef.current
    if (!target) return
    const ev = await api.clearKv(target)
    setEvents((xs) => xs.map((x) => (x.id === ev.id ? ev : x)))
  }, [api])

  const chooseTheme = (t: Theme): void => {
    applyTheme(t)
    setTheme(t)
  }

  // Web deck pages: the monitor shows the live one (video only, 30 fps). While no
  // output is active this window is the one whose first frames open the ready gate.
  const pages = useWebPages()
  const outputs = useWebOutputs()
  const liveWeb = program.shown?.web?.deckId ?? null
  const onMonitor = outputSource(program)
  const monitorStreams = onMonitor?.kind === 'stream' ? onMonitor.deckId : null
  const precapture = capturesForGate('operator', outputs)
    ? precaptureIds(pages.statuses, monitorStreams)
    : []
  const monitorStream = useMemo<StreamOptions>(
    () => ({
      canvas: program.canvas,
      fps: 30,
      generation: (id) => pages.generations[id] ?? 0,
      // Main counts these only while no output is active.
      onFrame: (id) => void api.webFrame(id).catch(() => undefined),
      onEnded: (id) => void api.webEnded(id).catch(() => undefined),
      label: 'Web page on Program'
    }),
    [api, program.canvas, pages.generations]
  )
  const [captureWarnings, setCaptureWarnings] = useState<WebCaptureWarning[]>([])
  useEffect(() => {
    let fresh = true
    const off = api.onWebCaptureWarnings((w) => {
      fresh = false
      setCaptureWarnings(w)
    })
    api
      .webCaptureWarnings()
      .then((w) => {
        if (fresh) setCaptureWarnings(w)
      })
      .catch((e: unknown) => console.warn('[web] capture warnings failed to load:', e))
    return off
  }, [api])

  const deck = currentDeck(decks, program)
  const ready = deck !== null

  return (
    <div className="app" ref={appRef}>
      <Header
        events={events}
        eventId={eventId}
        onSelectEvent={selectEvent}
        onCreateEvent={createEvent}
        onEventUpdated={replaceEvent}
        program={program}
        theme={theme}
        onSetTheme={chooseTheme}
      />
      <main>
        <Library
          decks={decks}
          imports={imports}
          currentDeckId={ready ? program.deckId : null}
          live={tally(program) === 'live' ? program.shown : null}
          frozen={tally(program) === 'frozen' ? program.shown : null}
          canImport={eventId !== null}
          kvUrl={program.kvUrl}
          kvOnAir={kvOnAir(program)}
          onSetKv={setKv}
          onClearKv={clearKv}
          onSelectDeck={(deckId) => dispatch({ type: 'selectDeck', deckId })}
          onDismissImport={(id) => setImports((xs) => xs.filter((x) => x.id !== id))}
          onFiles={importFiles}
          onMoveItem={moveListItem}
          sections={sections}
          onAddSection={addSection}
          onRenameSection={renameSection}
          onRemoveSection={removeSection}
          onSelectSection={(sectionId) => dispatch({ type: 'selectSection', sectionId })}
          onRemoveDeck={removeDeck}
          onRenameDeck={renameDeck}
          onSetDeckFit={setDeckFit}
          onSetDeckAudio={setDeckAudio}
        />
        <section className="stage-col" aria-label="Program">
          <ActionError message={actionError} onDismiss={() => setActionError(null)} />
          <CaptureWarning warnings={captureWarnings} />
          <Program
            state={program}
            deck={deck}
            posterVersion={liveWeb ? (pages.versions[liveWeb] ?? 0) : 0}
            stream={monitorStream}
            emptyHint={
              eventId ? undefined : 'Create an event first from the Event menu at the top left.'
            }
          />
          <Controls
            state={program}
            canPrev={canPrev(decks, program, sections)}
            canNext={canNext(decks, program, sections)}
            hasSections={sections.length > 0}
            canPrevSection={canPrevSection(decks, program, sections)}
            canNextSection={canNextSection(decks, program, sections)}
            canFreeze={reduce(program, { type: 'toggleFreeze' }, decks, sections) !== program}
            onAction={dispatch}
          />
        </section>
        <NextPanel decks={decks} sections={sections} state={program} onAction={dispatch} />
      </main>
      <Strip decks={decks} state={program} onGoto={goto} onMoveSlide={moveSlide} />
      <SaveNote text={note} />
      <Splitters appRef={appRef} />
      <DropOverlay onDrop={({ files, folders }) => importFiles(files, folders)} />
      <WebPrecapture deckIds={precapture} onGone={pages.refresh} />
    </div>
  )
}

export default App
