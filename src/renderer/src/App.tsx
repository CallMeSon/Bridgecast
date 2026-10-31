import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeckMeta, EventMeta, SectionMeta } from '../../shared/types'
import { orderItems, splitOrder } from '../../shared/sections'
import { initialState, kvOnAir, reduce, type Action, type ProgramState } from '../../shared/program'
import type { ImportRequest } from '../../shared/ipc'
import type { DeckFit } from '../../shared/canvas'
import type { Playback } from '../../shared/types'
import type { DeckAudio } from '../../shared/audio-levels'
import { Header } from './components/Header'
import { closeTab, loadOpenTabs, openTab, saveOpenTabs } from './open-tabs'
import { SettingsDialog } from './components/SettingsDialog'
import { Library, type ImportRow } from './components/Library'
import { DropOverlay } from './components/DropOverlay'
import { Program } from './components/Program'
import { Controls } from './components/Controls'
import { NextPanel } from './components/NextPanel'
import { DeckSettings } from './components/DeckSettings'
import { OutputStatus } from './components/OutputStatus'
import { useOutputSettings } from './components/useOutputSettings'
import {
  loadOpenSections,
  loadPanelTab,
  saveOpenSection,
  savePanelTab,
  type PanelTab,
  type SectionId
} from './panel-sections'
import { Strip } from './components/Strip'
import { Splitters } from './components/Splitters'
import { ActionError, SaveNote } from './components/ActionError'
import { CaptureWarning } from './components/CaptureWarning'
import { HoldWarning } from './components/HoldWarning'
import { EditErrorBanner, NativeFallbackWarning, PendingBanner } from './components/NativeNotices'
import { useSlideshow } from './slideshow'
import { engineName } from '../../shared/playback'
import type { PptImportFormat } from '../../shared/settings'
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
  canResumeWeb,
  currentDeck,
  editingAfter,
  errorMessage,
  fileKind,
  holdDeckId,
  keyToAction,
  moveItem,
  moveOrder,
  nativeNotice,
  nextView,
  stepLabel,
  outputSource,
  SAVED,
  sumVersions,
  tally,
  UNSUPPORTED,
  visibleCaptureWarnings
} from './model'
import {
  applyAppearance,
  applyReduceMotion,
  loadAccent,
  loadCustomAccent,
  loadReduceMotion,
  loadThemePref,
  saveAccent,
  saveCustomAccent,
  saveReduceMotion,
  saveThemePref,
  type AccentId,
  type Theme,
  type ThemePref
} from './theme'
const DEFAULT_CUSTOM = '#2160d4'
import { renderPdf } from './import/pdf'

const IMPORT_WIDTH = 1920
let importSeq = 0
const newImportId = (): string => `imp-${Date.now()}-${importSeq++}`

function App(): React.JSX.Element {
  const api = window.api
  const [events, setEvents] = useState<EventMeta[]>([])
  const [eventId, setEventId] = useState<string | null>(null)
  // Open event tabs (this window's localStorage) and what the main area shows.
  const [openIds, setOpenIds] = useState<string[]>([])
  const [view, setView] = useState<'console' | 'home'>('console')
  const tabsLoaded = useRef(false)
  const [decks, setDecks] = useState<DeckMeta[]>([])
  // The event the loaded `decks` belong to. Sections follow this, not `eventId`, so
  // decks and sections never come from two different events while a switch loads.
  const [decksEventId, setDecksEventId] = useState<string | null>(null)
  const [program, setProgram] = useState<ProgramState>(initialState)
  const [imports, setImports] = useState<ImportRow[]>([])
  const [themePref, setThemePref] = useState<ThemePref>(loadThemePref)
  const [accent, setAccent] = useState(loadAccent)
  const [customHex, setCustomHex] = useState(() => loadCustomAccent() ?? DEFAULT_CUSTOM)
  const [reduceMotion, setReduceMotion] = useState(loadReduceMotion)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const output = useOutputSettings()
  const [panelTab, setPanelTab] = useState<PanelTab>(() => loadPanelTab(localStorage))
  const [openSections, setOpenSections] = useState(() => loadOpenSections(localStorage))
  const choosePanelTab = (t: PanelTab): void => {
    savePanelTab(localStorage, t)
    setPanelTab(t)
  }
  const toggleSection = (id: SectionId, open: boolean): void =>
    setOpenSections((cur) => saveOpenSection(localStorage, cur, id, open))
  // The header output status leads to the Output section: open it, read the settings again.
  const showOutput = (): void => {
    choosePanelTab('controls')
    toggleSection('output', true)
    output.reload()
    requestAnimationFrame(() => {
      const sec = document.querySelector<HTMLElement>('[data-testid=output-section]')
      sec?.scrollIntoView({ block: 'nearest' })
      sec?.querySelector<HTMLElement>('[role=switch]')?.focus()
    })
  }
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  )
  useEffect(() => applyAppearance(themePref, accent, setTheme), [themePref, accent, customHex])
  useEffect(() => applyReduceMotion(reduceMotion), [reduceMotion])
  const sections = useMemo<SectionMeta[]>(
    () => events.find((e) => e.id === decksEventId)?.sections ?? [],
    [events, decksEventId]
  )
  const eventRef = useRef<string | null>(null)
  const airRef = useRef<string | null>(null)
  useEffect(() => {
    airRef.current = program.airEvent
  }, [program.airEvent])
  useEffect(() => {
    if (tabsLoaded.current) saveOpenTabs(localStorage, openIds)
  }, [openIds])
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
      // A finished import with a message is a warning (missing fonts): keep its row until dismissed.
      upsertImport(
        p.status === 'done' && p.message
          ? { ...p, status: 'error', meta: 'Imported, check the fonts' }
          : p
      )
      if (p.status === 'done') reloadDecks(eventRef.current).catch((e) => reportError(p.name, e))
    })
    ;(async () => {
      const [session, evs] = await Promise.all([api.getSession(), api.listEvents()])
      eventRef.current = session.eventId
      setEvents(evs)
      setEventId(session.eventId)
      setOpenIds(
        loadOpenTabs(
          localStorage,
          evs.map((e) => e.id),
          session.eventId
        )
      )
      tabsLoaded.current = true
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
  const outputAudio = output.audio
  const setOutputAudio = output.setAudio
  // Transport sound button: mute the output through a one-field patch (no stale write).
  const toggleMute = useCallback(() => {
    if (!outputAudio) return
    api.patchAudio({ muted: !outputAudio.muted }).then(
      (s) => {
        setOutputAudio(s.audio)
        setActionError(null)
      },
      (e) => setActionError(errorMessage(e))
    )
  }, [api, outputAudio, setOutputAudio])
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
        setView('console')
        setOpenIds((ids) => openTab(ids, id, [id, airRef.current]))
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

  // Closing a tab removes the tab only: the output never changes. Closing the current tab
  // selects its left neighbour; closing the last one shows Home.
  const closeEventTab = useCallback(
    (id: string) => {
      const r = closeTab(openIds, id, eventId)
      setOpenIds(r.ids)
      if (id === eventId) {
        if (r.next) void selectEvent(r.next)
        else setView('home')
      }
    },
    [openIds, eventId, selectEvent]
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
        const r = await renderPdf(
          data,
          IMPORT_WIDTH,
          (done, total) =>
            upsertImport({
              id,
              name,
              percent: 5 + Math.round((85 * done) / total),
              status: 'busy'
            }),
          api.pathForFile(f) || undefined
        )
        upsertImport({ id, name, percent: 95, status: 'busy' })
        await api.addRendered(target, {
          name: baseName(f.name),
          width: r.width,
          height: r.height,
          pages: r.pages,
          ...(r.sourcePath ? { sourcePath: r.sourcePath } : {})
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

  // Edit in PowerPoint, Revert and the playback mode. The decks are read again when the new
  // version is applied (`deck:pending` false, see useSlideshow).
  const [editing, setEditing] = useState<string[]>([])
  const editDeck = useCallback(
    (deckId: string, confirmed?: boolean) => {
      api.editDeck(deckId, confirmed).then(
        () => setEditing((xs) => editingAfter(xs, 'start', deckId)),
        (e) => reportError('Edit deck', e)
      )
    },
    [api, reportError]
  )
  const editDeckDone = useCallback(
    (deckId: string) => {
      setEditing((xs) => editingAfter(xs, 'done', deckId))
      api.editDeckDone(deckId).catch((e) => reportError('Edit deck', e))
    },
    [api, reportError]
  )
  const revertDeck = useCallback(
    (deckId: string) => {
      setEditing((xs) => editingAfter(xs, 'revert', deckId))
      api.revertDeck(deckId).catch((e) => reportError('Revert', e))
    },
    [api, reportError]
  )
  const applyDeckNow = useCallback(
    (deckId: string) => {
      api.applyDeckNow(deckId).catch((e) => reportError('Apply now', e))
    },
    [api, reportError]
  )
  const setDeckPlayback = useCallback(
    (deckId: string, playback: Playback) => {
      const target = eventRef.current
      if (!target) return
      api
        .setDeckPlayback(target, deckId, playback)
        .then(
          (meta) =>
            setDecks((ds) =>
              ds.map((d) => (d.id === meta.id ? { ...d, playback: meta.playback } : d))
            ),
          (e) => reportError('Playback', e)
        )
        .finally(() => reloadDecks(target).catch((e) => reportError('Decks', e)))
    },
    [api, reloadDecks, reportError]
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

  // Web decks. Main checks the address again; its refusal goes back to the dialog.
  const addWeb = useCallback(
    async (url: string, name: string | undefined) => {
      const target = eventRef.current
      if (!target) throw new Error('Choose an event first, then add the web page.')
      await api.addWebDeck(target, url, name)
      await reloadDecks(target)
    },
    [api, reloadDecks]
  )
  const setWebUrl = useCallback(
    async (deckId: string, url: string) => {
      const target = eventRef.current
      await api.setWebUrl(deckId, url)
      await reloadDecks(target)
    },
    [api, reloadDecks]
  )
  const reloadWeb = useCallback(
    (deckId: string) => {
      const name = decks.find((d) => d.id === deckId)?.name ?? 'Web page'
      api.reloadWeb(deckId).catch((e) => reportError(name, e))
    },
    [api, decks, reportError]
  )
  const prepareWeb = useCallback(
    (deckId: string) => {
      const name = decks.find((d) => d.id === deckId)?.name ?? 'Web page'
      api.openPrepare(deckId).catch((e) => reportError(name, e))
    },
    [api, decks, reportError]
  )

  const chooseThemePref = (p: ThemePref): void => {
    saveThemePref(p)
    setThemePref(p)
  }
  const chooseTheme = (t: Theme): void => chooseThemePref(t)
  const chooseAccent = (a: AccentId): void => {
    saveAccent(a)
    setAccent(a)
  }
  const chooseCustom = (hex: string): void => {
    saveCustomAccent(hex)
    setCustomHex(hex)
  }
  const chooseReduceMotion = (on: boolean): void => {
    saveReduceMotion(on)
    setReduceMotion(on)
  }

  // Web deck pages: the monitor shows the live one (video only, 30 fps). While no
  // output is active this window is the one whose first frames open the ready gate.
  const pages = useWebPages()
  const [importFormat, setImportFormat] = useState<PptImportFormat>('odp')
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setImportFormat(s.pptImportFormat))
      .catch((e: unknown) => console.warn('[settings] import format failed to load:', e))
  }, [api])
  const changeImportFormat = useCallback(
    (format: PptImportFormat) => {
      const before = importFormat
      setImportFormat(format)
      api.setImportFormat(format).catch((e) => {
        setImportFormat(before)
        reportError('Import format', e)
      })
    },
    [api, importFormat, reportError]
  )
  const slideshow = useSlideshow(
    useCallback(() => {
      // The deck's files were replaced: read slides, clicks and hidden flags again.
      // The edit session goes on (the working copy is still watched): `editing` stays.
      const target = eventRef.current
      if (target) reloadDecks(target).catch((e) => reportError('Decks', e))
    }, [reloadDecks, reportError])
  )
  // Per deck: bumped when a web snapshot or an edited deck's images were rewritten under the same names.
  const versions = useMemo(() => {
    return sumVersions(pages.versions, slideshow.versions)
  }, [pages.versions, slideshow.versions])
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
      onFrame: (id, source) =>
        void (source === 'desktop' ? api.slideshowFrame(id) : api.webFrame(id)).catch(
          () => undefined
        ),
      onEnded: (id, source) => {
        if (source === 'tab') void api.webEnded(id).catch(() => undefined)
      },
      // Main waits for this only while no output is active.
      onPaused: (id, source) => {
        if (source === 'tab') void api.webHeld(id).catch(() => undefined)
      },
      label: 'Live page on Program'
    }),
    [api, program.canvas, pages.generations]
  )
  // A snapshot is rewritten under the same name when its deck leaves air (no status event
  // of its own): reload the thumbnails and the poster then, and again once it is written.
  const prevLiveWeb = useRef<string | null>(null)
  const { bump } = pages
  useEffect(() => {
    const left = prevLiveWeb.current
    prevLiveWeb.current = liveWeb
    if (!left || left === liveWeb) return
    bump(left)
    const t = setTimeout(() => bump(left), 1500)
    return () => clearTimeout(t)
  }, [liveWeb, bump])
  // A page title can rename its deck after the first load: read the list again on status changes.
  const { statuses: webStatuses } = pages
  useEffect(() => {
    if (Object.keys(webStatuses).length === 0) return
    const t = setTimeout(() => {
      const target = eventRef.current
      if (target) reloadDecks(target).catch((e) => reportError('Decks', e))
    }, 400)
    return () => clearTimeout(t)
  }, [webStatuses, reloadDecks, reportError])
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

  // Why PowerPoint's sound plays on this PC's default device only (null = nothing to say).
  const [slideNote, setSlideNote] = useState<string | null>(null)
  useEffect(() => {
    let fresh = true
    const off = api.onSlideshowNote((n) => {
      fresh = false
      setSlideNote(n)
    })
    api
      .slideshowNote()
      .then((n) => {
        if (fresh) setSlideNote(n)
      })
      .catch((e: unknown) => console.warn('[slideshow] sound note failed to load:', e))
    return off
  }, [api])

  const deck = currentDeck(decks, program)
  const nx = nextView(decks, program, sections)
  const nextLabel = nx.kind === 'slide' && !nx.held ? `Next: slide ${nx.index + 1}` : null
  const ready = deck !== null
  const notice = nativeNotice(program, decks, slideshow.status)
  // Saved edits that wait because their deck is on air (Apply now).
  const pendingLive = decks.filter(
    (d) => slideshow.pending.includes(d.id) && program.shown?.deckId === d.id
  )

  return (
    <div className="app" ref={appRef} data-view={view}>
      <Header
        events={events}
        eventId={eventId}
        openIds={openIds}
        view={view}
        airEvent={program.airEvent}
        airState={tally(program)}
        onSelectEvent={selectEvent}
        onCloseTab={closeEventTab}
        onHome={() => setView((v) => (v === 'home' ? 'console' : 'home'))}
        onCreateEvent={createEvent}
        program={program}
        output={output}
        onOpenOutput={showOutput}
        theme={theme}
        onSetTheme={chooseTheme}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        themePref={themePref}
        onThemePref={chooseThemePref}
        accent={accent}
        onAccent={chooseAccent}
        customHex={customHex}
        onCustomHex={chooseCustom}
        reduceMotion={reduceMotion}
        onReduceMotion={chooseReduceMotion}
      />
      {view === 'home' && (
        <section className="home-stub" aria-label="Events home">
          <p>No event open. Choose a tab or create one with New.</p>
        </section>
      )}
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
          engineName={engineName(slideshow.status.engine)}
          importFormat={
            slideshow.status.engine === 'libreoffice'
              ? { value: importFormat, onChange: changeImportFormat }
              : undefined
          }
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
          webStatuses={pages.statuses}
          holdDeckId={holdDeckId(program)}
          onAddWeb={addWeb}
          onSetWebUrl={setWebUrl}
          onReloadWeb={reloadWeb}
          onPrepareWeb={prepareWeb}
          engine={slideshow.status.decks}
          editing={editing}
          isEdited={api.isDeckEdited}
          onEditDeck={editDeck}
          onEditDone={editDeckDone}
          onRevertDeck={revertDeck}
          onSetPlayback={setDeckPlayback}
        />
        <section className="stage-col" aria-label="Program">
          <ActionError message={actionError} onDismiss={() => setActionError(null)} />
          {program.webHold && (
            <HoldWarning
              lost={!!program.shown?.web && pages.statuses[program.shown.web.deckId] === 'error'}
              canResume={canResumeWeb(program, pages.statuses)}
              onResume={() => dispatch({ type: 'resumeWeb' })}
            />
          )}
          {notice && (
            <NativeFallbackWarning
              notice={notice}
              canResume={
                !!program.shown && slideshow.status.resumable.includes(program.shown.deckId)
              }
              onResume={() =>
                program.shown && dispatch({ type: 'resumeNative', deckId: program.shown.deckId })
              }
              app={engineName(slideshow.status.engine)}
              helperText={slideshow.status.helperError}
            />
          )}
        audio={outputAudio}
        onAudioSaved={setOutputAudio}
          {pendingLive.map((d) => (
            <PendingBanner key={d.id} deckName={d.name} onApplyNow={() => applyDeckNow(d.id)} />
          ))}
          {slideshow.editError && (
            <EditErrorBanner error={slideshow.editError} onDismiss={slideshow.clearEditError} />
          )}
          <CaptureWarning
            warnings={visibleCaptureWarnings(captureWarnings, program)}
            extra={
              slideNote
                ? [...Object.values(pages.warnings), slideNote]
                : Object.values(pages.warnings)
            }
          />
          <Program
            state={program}
            deck={deck}
            posterVersion={program.shown ? (versions[program.shown.deckId] ?? 0) : 0}
            stepLabel={stepLabel(program, decks)}
            nextLabel={nextLabel}
            canPrev={canPrev(decks, program, sections)}
            canNext={canNext(decks, program, sections)}
            canFreeze={reduce(program, { type: 'toggleFreeze' }, decks, sections) !== program}
            muted={outputAudio?.muted ?? null}
            onToggleMute={toggleMute}
            onAction={dispatch}
            stream={monitorStream}
            emptyHint={eventId ? undefined : 'Create an event first with New in the header.'}
            airEventName={
              program.airEvent && program.airEvent !== eventId && tally(program) !== 'idle'
                ? (events.find((e) => e.id === program.airEvent)?.name ?? null)
                : null
            }
          />
        </section>
        <NextPanel
          decks={decks}
          sections={sections}
          state={program}
          webStatuses={pages.statuses}
          versions={versions}
          onAction={dispatch}
          tab={panelTab}
          onTab={choosePanelTab}
          isOpen={(id) => openSections[id]}
          onToggle={toggleSection}
          navigation={
            <Controls
              hasSections={sections.length > 0}
              canPrevSection={canPrevSection(decks, program, sections)}
              canNextSection={canNextSection(decks, program, sections)}
              canPrevDeck={reduce(program, { type: 'prevDeck' }, decks, sections) !== program}
              canNextDeck={reduce(program, { type: 'nextDeck' }, decks, sections) !== program}
              onAction={dispatch}
            />
          }
          deckSettings={
            <DeckSettings
              deck={deck ?? undefined}
              event={events.find((e) => e.id === eventId)}
              program={program}
              onSetDeckFit={setDeckFit}
              onSetDeckAudio={setDeckAudio}
              onEventUpdated={replaceEvent}
            />
          }
          output={
            <OutputStatus
              out={output}
              program={program}
              isOpen={(id) => openSections[id]}
              onToggle={toggleSection}
            />
          }
        />
      </main>
      <Strip
        decks={decks}
        state={program}
        onGoto={goto}
        onMoveSlide={moveSlide}
        versions={versions}
      />
      <SaveNote text={note} />
      <Splitters appRef={appRef} />
      <DropOverlay onDrop={({ files, folders }) => importFiles(files, folders)} />
      <WebPrecapture deckIds={precapture} onGone={pages.refresh} />
    </div>
  )
}

export default App
