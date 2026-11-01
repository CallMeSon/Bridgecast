import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CursorClickIcon,
  DotsThreeVerticalIcon,
  HouseSimpleIcon,
  MapTrifoldIcon,
  SignOutIcon,
  XIcon
} from '@phosphor-icons/react'
import { slideUrl } from '../../shared/ipc'
import type { ProgramState } from '../../shared/program'
import type { DeckMeta } from '../../shared/types'
import {
  sanitizeWebUrl,
  webDomain,
  type PrepareInput,
  type WebNavState,
  type WebStatus
} from '../../shared/web'
import { StatusTag } from './components/StatusTag'
import { StreamLayer } from './components/StreamLayer'
import {
  errorMessage,
  keyToAction,
  type PrepareBanner,
  prepareBanner,
  prepareBannerText,
  toPrepareChar,
  toPrepareInput
} from './model'
import {
  addressShown,
  homeDisabled,
  interactLocked,
  keyRoute,
  nextInteract,
  stageCursor
} from './prepare-ui'
import { PrepareMiniMap } from './components/PrepareMiniMap'
import { centred, clampPan, layout, panBy, type View, type ViewMode } from './prepare-view'

/** The preview is for looking and clicking: video only at 30 fps (spec 3). */
const PREVIEW_FPS = 30
const VIEW_KEY = 'prepare-view'
const MAP_KEY = 'prepare-map'
/** How long the "keyboard released" note stays in the status line. */
const RELEASED_MS = 4000

function readMapShown(): boolean {
  try {
    return localStorage.getItem(MAP_KEY) !== 'hidden'
  } catch {
    return true
  }
}

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'actual' ? 'actual' : 'fit'
  } catch {
    return 'fit'
  }
}

/** Device pixels per CSS pixel; follows the window to a display with another scale. */
function useDpr(): number {
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1)
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const on = (): void => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [dpr])
  return dpr
}

const SIGN_OUT_CONFIRM = 'Sign out of all websites on this PC? Web decks will reload.'

/**
 * Prepare window (route `#/prepare?deck=<id>`): opens a web deck's page in a
 * preview with the canvas aspect so the operator can sign in and set the page up
 * before it goes on air. Input reaches the page only while the deck is not on air
 * or is frozen (main refuses it otherwise); while it is on air the app shortcuts
 * work here instead, so a clicker never types into the page. This preview never
 * reports a frame to main: it can not open the ready gate.
 */
export function PrepareView({ deckId }: { deckId: string }): React.JSX.Element {
  const api = window.api
  const [program, setProgram] = useState<ProgramState | null>(null)
  const [deck, setDeck] = useState<DeckMeta | null | undefined>(undefined)
  const [status, setStatus] = useState<{ status: WebStatus; message?: string } | null>(null)
  const [generation, setGeneration] = useState(0)
  const [address, setAddress] = useState('')
  const [addressNote, setAddressNote] = useState<{ text: string; problem: boolean } | null>(null)
  const [nav, setNav] = useState<WebNavState | null>(null)
  const [focused, setFocused] = useState(false)
  const [edited, setEdited] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [mode, setMode] = useState<ViewMode>(readViewMode)
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [interact, setInteract] = useState(false)
  const [mapShown, setMapShown] = useState(readMapShown)
  const [stageFocused, setStageFocused] = useState(false)
  const [released, setReleased] = useState(false)
  const dpr = useDpr()

  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const urlField = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const interactButton = useRef<HTMLButtonElement>(null)
  const prevBanner = useRef<PrepareBanner | null>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const releasedTimer = useRef(0)

  // Program state (same source as the operator and output windows): a broadcast is newer than the first fetch.
  useEffect(() => {
    let fresh = true
    const off = api.onProgramState((s) => {
      fresh = false
      setProgram(s)
    })
    api
      .getSession()
      .then(async (session) => {
        if (fresh) setProgram(session.state)
        const decks = session.eventId ? await api.listDecks(session.eventId) : []
        const found = decks.find((d) => d.id === deckId) ?? null
        setDeck(found)
        const url = found?.web?.url
        if (url) setAddress((prev) => prev || url)
      })
      .catch((e: unknown) => {
        console.error('[prepare] state failed to load:', e)
        setDeck(null)
      })
    return off
  }, [api, deckId])

  // Page status; a page that comes back from an error is captured again with a new source id.
  useEffect(() => {
    let fresh = true
    const off = api.onWebStatus((e) => {
      if (e.deckId !== deckId) return
      fresh = false
      setStatus((prev) => {
        if (prev?.status === 'error' && e.status !== 'error') setGeneration((g) => g + 1)
        return { status: e.status, message: e.message }
      })
    })
    api
      .webStatuses()
      .then((list) => {
        const mine = list.find((e) => e.deckId === deckId)
        if (fresh && mine) setStatus({ status: mine.status, message: mine.message })
      })
      .catch((e: unknown) => console.warn('[prepare] page status failed to load:', e))
    return off
  }, [api, deckId])

  // Where the page is now (address, title, history, loading); a broadcast is newer than the first fetch.
  useEffect(() => {
    let fresh = true
    const off = api.onWebNavState((s) => {
      if (s.deckId !== deckId) return
      fresh = false
      setNav(s)
    })
    api
      .webNavStates()
      .then((list) => {
        const mine = list.find((s) => s.deckId === deckId)
        if (fresh && mine) setNav(mine)
      })
      .catch((e: unknown) => console.warn('[prepare] page state failed to load:', e))
    return off
  }, [api, deckId])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = (): void => setBox({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    document.title = deck
      ? `Prepare: ${deck.name}${nav?.title ? ` · ${nav.title}` : ''}`
      : 'Prepare web page'
  }, [deck, nav?.title])

  const banner = program ? prepareBanner(program, deckId) : null
  const live = banner === 'live'
  // Interact: starts on for a deck that is not on air, off when frozen; live forces it off.
  useEffect(() => {
    if (!banner) return
    const prev = prevBanner.current
    prevBanner.current = banner
    setInteract((on) => nextInteract(on, prev, { kind: 'banner', banner }))
  }, [banner])
  useEffect(() => () => window.clearTimeout(releasedTimer.current), [])
  const canvas = program?.canvas
  // Fit draws the whole page in the box; 100% draws one page pixel per device pixel and pans.
  // A pan of null means centred; it is re-clamped on every render, so a resize never strands it.
  const view: View = !canvas
    ? { mode: 'fit', panX: 0, panY: 0 }
    : mode === 'fit'
      ? { mode: 'fit', panX: 0, panY: 0 }
      : pan
        ? clampPan(canvas, box, { mode: 'actual', panX: pan.x, panY: pan.y }, dpr)
        : centred(canvas, box, dpr)
  const lay = canvas
    ? layout(canvas, box, view, dpr)
    : { left: 0, top: 0, width: 0, height: 0, scale: 0, cropped: false }
  const stageSize =
    mode === 'fit'
      ? { width: lay.width, height: lay.height }
      : { width: box.width, height: box.height }
  const pageLeft = mode === 'fit' ? 0 : lay.left
  const pageTop = mode === 'fit' ? 0 : lay.top
  const setView = (m: ViewMode): void => {
    setMode(m)
    setPan(null)
    try {
      localStorage.setItem(VIEW_KEY, m)
    } catch {
      /* private window: the choice just is not remembered */
    }
  }
  const panTo = (v: View): void => {
    if (canvas) setPan({ x: v.panX, y: v.panY })
  }

  // Live: app shortcuts work from here (a clicker presses Next); every other key is ignored.
  useEffect(() => {
    if (!live) return
    const onKey = (e: KeyboardEvent): void => {
      // Space on a focused button presses that button; menu keys stay with the menu.
      const t = e.target as HTMLElement | null
      if (t?.closest('button, [role="menuitem"]') && (e.key === ' ' || e.key === 'Enter')) return
      const a = keyToAction(e)
      if (!a) return
      e.preventDefault()
      api.dispatch(a).catch((err: unknown) => console.warn('[prepare] shortcut failed:', err))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api, live])

  const send = useCallback(
    (input: PrepareInput | null) => {
      if (!input) return
      // Main refuses input while the deck is live and not frozen; nothing to show for a refusal.
      api.webInput(deckId, input).catch((e: unknown) => console.warn('[prepare] input failed:', e))
    },
    [api, deckId]
  )
  // Input reaches the page only with Interact on; main still refuses it while live and not frozen.
  const locked = banner !== null && interactLocked(banner)
  const canSend = (banner === 'idle' || banner === 'frozen') && interact
  const sendLeave = useCallback(
    (clientX: number, clientY: number) => {
      const r = page.current?.getBoundingClientRect()
      if (!r) return
      send(
        toPrepareInput(
          { type: 'mouseleave', clientX, clientY, button: 0, detail: 0 } as MouseEvent,
          r
        )
      )
    },
    [send]
  )
  // Pointer positions are normalized against the drawn page (not the clipping stage), so a
  // click maps to the right page point at every view mode and pan offset.
  const stageBox = (): DOMRect | null => page.current?.getBoundingClientRect() ?? null
  // Interact off (or locked on air): a drag pans a cropped page and nothing reaches the page.
  // Interact on: clicks go to the page; Space+drag pans while the page does not hold the
  // keyboard (the stage is not focused), so Space typed into a field is never taken.
  const canPan = lay.cropped
  const dragPans = (): boolean =>
    canPan && (!canSend || (spaceHeld && document.activeElement !== stage.current))
  const panReady = canPan && (!canSend || (spaceHeld && !stageFocused))
  const panDrag = useRef<{ x: number; y: number; view: View } | null>(null)
  useEffect(() => {
    if (!panning) return
    const onMove = (e: MouseEvent): void => {
      const d = panDrag.current
      if (!d || !canvas) return
      panTo(panBy(canvas, box, d.view, dpr, e.clientX - d.x, e.clientY - d.y))
    }
    const onUp = (): void => {
      panDrag.current = null
      setPanning(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // panTo only sets state; the drag reads its start view from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panning, canvas, box, dpr])
  // Space is tracked on the window so the pan hand shows before the drag starts.
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    const off = (): void => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', off)
    }
  }, [])

  // Mouse moves are sent at most once per frame (the latest position).
  const pendingMove = useRef<MouseEvent | null>(null)
  const moveFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(moveFrame.current), [])
  const dragging = useRef(false)

  // A button released outside the preview still ends the press on the page.
  useEffect(() => {
    const onUp = (e: MouseEvent): void => {
      if (!dragging.current) return
      dragging.current = false
      const r = stageBox()
      if (!r || !canSend) return
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      )
        return
      const clamped = {
        type: 'mouseup',
        button: e.button,
        detail: 1,
        clientX: Math.min(Math.max(e.clientX, r.left), r.right),
        clientY: Math.min(Math.max(e.clientY, r.top), r.bottom)
      } as MouseEvent
      send(toPrepareInput(clamped, r))
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [canSend, send])

  const onMouse = (e: React.MouseEvent): void => {
    if (e.type === 'mousedown' && e.button === 0 && canvas && dragPans()) {
      e.preventDefault()
      panDrag.current = { x: e.clientX, y: e.clientY, view }
      setPanning(true)
      return
    }
    if (!canSend) return
    const r = stageBox()
    if (!r) return
    if (e.type === 'mousemove') {
      lastPoint.current = { x: e.clientX, y: e.clientY }
      pendingMove.current = e.nativeEvent
      if (!moveFrame.current) {
        moveFrame.current = requestAnimationFrame(() => {
          moveFrame.current = 0
          const m = pendingMove.current
          pendingMove.current = null
          const rect = stageBox()
          if (m && rect) send(toPrepareInput(m, rect))
        })
      }
      return
    }
    if (e.type === 'mousedown') dragging.current = true
    if (e.type === 'mouseup') dragging.current = false
    send(toPrepareInput(e.nativeEvent, r))
  }
  // Leaving the preview tells the page the pointer left, so a hover menu does not stay open.
  const onMouseLeave = (e: React.MouseEvent): void => {
    cancelAnimationFrame(moveFrame.current)
    moveFrame.current = 0
    pendingMove.current = null
    const had = lastPoint.current
    lastPoint.current = null
    if (!canSend || dragging.current || !had) return
    sendLeave(e.clientX, e.clientY)
  }
  const toggleInteract = (): void => {
    const turningOff = interact
    setInteract((on) => nextInteract(on, prevBanner.current, { kind: 'press' }))
    const had = lastPoint.current
    if (turningOff && canSend && had) {
      lastPoint.current = null
      sendLeave(had.x, had.y)
    }
  }
  const onWheel = (e: React.WheelEvent): void => {
    // Interact off or locked: the wheel pans a cropped page. Otherwise it scrolls the page.
    if (!canSend) {
      if (canvas && canPan) panTo(panBy(canvas, box, view, dpr, -e.deltaX / dpr, -e.deltaY / dpr))
      return
    }
    const r = stageBox()
    if (canSend && r) send(toPrepareInput(e.nativeEvent, r))
  }
  const onKey = (e: React.KeyboardEvent): void => {
    // The stage is the target, so it holds the keyboard whenever Interact is on.
    const route = banner
      ? keyRoute({ key: e.key, spaceForPan: canPan }, { interact, holdsKeyboard: true, banner })
      : 'none'
    // F6 moves focus out of the page, so the keyboard is never trapped in the preview.
    if (route === 'leave') {
      e.preventDefault()
      urlField.current?.focus()
      return
    }
    if (!canSend) return
    const r = stageBox()
    if (!r) return
    if (route === 'release') {
      e.preventDefault()
      // Esc reaches the page once (it closes page dialogs), then the keyboard is given back.
      // The key-up lands on the button, so both halves are sent now.
      if (e.type === 'keydown') {
        send(toPrepareInput(e.nativeEvent, r))
        const up = {
          type: 'keyup',
          key: e.key,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey
        } as KeyboardEvent
        send(toPrepareInput(up, r))
        interactButton.current?.focus()
        setReleased(true)
        window.clearTimeout(releasedTimer.current)
        releasedTimer.current = window.setTimeout(() => setReleased(false), RELEASED_MS)
      }
      return
    }
    if (route !== 'page') return
    e.preventDefault()
    send(toPrepareInput(e.nativeEvent, r))
    if (e.type === 'keydown') send(toPrepareChar(e.nativeEvent))
  }

  const run = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => setAddressNote({ text: errorMessage(e), problem: true }))
  }
  const submitAddress = (e: React.FormEvent): void => {
    e.preventDefault()
    const checked = sanitizeWebUrl(address)
    if ('error' in checked) {
      setAddressNote({ text: checked.error, problem: true })
      return
    }
    setAddressNote(checked.warning ? { text: checked.warning, problem: false } : null)
    api.setWebUrl(deckId, address).then(
      (d) => {
        setDeck(d)
        if (d.web) setAddress(d.web.url)
        setEdited(false)
      },
      (err: unknown) => setAddressNote({ text: errorMessage(err), problem: true })
    )
  }

  const closeMenu = useCallback((refocus: boolean) => {
    setMenuOpen(false)
    if (refocus) menuButton.current?.focus()
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !menuButton.current?.contains(t)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])
  const signOut = (): void => {
    closeMenu(true)
    if (!window.confirm(SIGN_OUT_CONFIRM)) return
    setAddressNote(null)
    run(api.signOutWeb())
  }

  const loading = nav?.loading ?? false
  const canBack = nav?.canGoBack ?? false
  const canForward = nav?.canGoForward ?? false
  const noHome = homeDisabled(nav?.url ?? null, deck?.web?.url)
  const shownAddress = addressShown({
    pageUrl: nav?.url ?? null,
    typed: address,
    editing: focused || edited
  })
  const domain = webDomain(deck?.web?.url ?? address)
  const failure =
    status?.status === 'error'
      ? (status.message ?? `Could not open ${domain}. Check the internet connection, then Reload.`)
      : null

  if (deck === null) {
    return (
      <main className="prepare">
        <p className="prepare-gone" role="alert">
          This web page is not part of the open event. Close this window.
        </p>
      </main>
    )
  }

  return (
    <main className="prepare">
      <div className="prepare-bar" role="toolbar" aria-label="Web page">
        <button
          type="button"
          className="btn sm prepare-icon"
          aria-label="Back"
          title={live ? 'Locked while on air' : canBack ? 'Back' : 'No earlier page'}
          disabled={live || !canBack}
          onClick={() => run(api.navWeb(deckId, 'back'))}
        >
          <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn sm prepare-icon"
          aria-label="Forward"
          title={live ? 'Locked while on air' : canForward ? 'Forward' : 'No later page'}
          disabled={live || !canForward}
          onClick={() => run(api.navWeb(deckId, 'forward'))}
        >
          <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
        </button>
        {loading ? (
          <button
            type="button"
            className="btn sm prepare-icon"
            aria-label="Stop loading"
            title="Stop loading"
            onClick={() => run(api.stopWeb(deckId))}
          >
            <XIcon size={16} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="btn sm prepare-icon"
            aria-label="Reload"
            title={live ? 'Reload (on air: the output goes to HOLD first)' : 'Reload'}
            onClick={() => run(api.reloadWeb(deckId))}
          >
            <ArrowClockwiseIcon size={16} weight="bold" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="btn sm prepare-icon"
          aria-label="Go to the deck address"
          title={
            noHome
              ? 'Already at the deck address'
              : live
                ? 'Go to the deck address (on air: the output goes to HOLD first)'
                : 'Go to the deck address'
          }
          disabled={noHome}
          onClick={() => run(api.homeWeb(deckId))}
        >
          <HouseSimpleIcon size={16} weight="bold" aria-hidden="true" />
        </button>
        <form className="prepare-address" onSubmit={submitAddress}>
          <label className="visually-hidden" htmlFor="prepare-url">
            Web address
          </label>
          <input
            id="prepare-url"
            ref={urlField}
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            value={shownAddress}
            disabled={live}
            aria-describedby={addressNote ? 'prepare-note' : undefined}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setEdited(true)
              setAddress(e.target.value)
              setAddressNote(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              setEdited(false)
              setAddressNote(null)
              setAddress(nav?.url ?? deck?.web?.url ?? '')
              stage.current?.focus()
            }}
          />
          {loading && (
            <>
              <span className="prepare-loadbar" aria-hidden="true" />
              <span className="prepare-loadtext" aria-hidden="true">
                Loading
              </span>
            </>
          )}
        </form>
        <div className="prepare-more">
          <button
            ref={menuButton}
            type="button"
            className="btn sm prepare-icon"
            aria-label="More"
            title="More"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <DotsThreeVerticalIcon size={16} weight="bold" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              className="menu prepare-menu"
              role="menu"
              aria-label="More"
              ref={menu}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeMenu(true)
                } else if (e.key === 'Tab') closeMenu(false)
              }}
            >
              <button type="button" role="menuitem" onClick={signOut}>
                <SignOutIcon size={16} aria-hidden="true" />
                Sign out of all websites
              </button>
            </div>
          )}
        </div>
      </div>

      {addressNote && (
        <p
          id="prepare-note"
          className={`prepare-note${addressNote.problem ? ' problem' : ''}`}
          role={addressNote.problem ? 'alert' : 'status'}
        >
          {addressNote.text}
        </p>
      )}

      <div className="prepare-banner" data-state={banner ?? 'idle'} role="status">
        {banner && banner !== 'idle' && <StatusTag kind={banner === 'live' ? 'live' : 'frozen'} />}
        {banner && <span>{prepareBannerText(banner, interact)}</span>}
        {released && (
          <span className="prepare-released">Keyboard released. Click the page to type again.</span>
        )}
      </div>

      {failure && (
        <p className="prepare-note problem" role="alert">
          {failure}
        </p>
      )}

      <div className="prepare-viewrow">
        <div className="prepare-seg" role="group" aria-label="Page view">
          <button
            type="button"
            className="prepare-segbtn"
            aria-pressed={mode === 'fit'}
            title="Fit the whole page in the window"
            onClick={() => setView('fit')}
          >
            Fit
          </button>
          <button
            type="button"
            className="prepare-segbtn"
            aria-pressed={mode === 'actual'}
            title="One page pixel per screen pixel. Drag or use the mini-map to move."
            onClick={() => setView('actual')}
          >
            100%
          </button>
        </div>
        {mode === 'actual' && lay.cropped && (
          <button
            type="button"
            className="prepare-togglebtn"
            aria-pressed={mapShown}
            title={mapShown ? 'Hide the mini-map to reach the corner' : 'Show the mini-map'}
            onClick={() => {
              setMapShown(!mapShown)
              try {
                localStorage.setItem(MAP_KEY, mapShown ? 'hidden' : 'shown')
              } catch {
                /* the choice just is not remembered */
              }
            }}
          >
            <MapTrifoldIcon size={16} weight="bold" aria-hidden="true" />
            Map
          </button>
        )}
        <button
          ref={interactButton}
          type="button"
          className="prepare-togglebtn prepare-interact"
          aria-pressed={interact}
          disabled={locked}
          title={
            locked
              ? 'Locked while on air. Press F to freeze first.'
              : interact
                ? 'Interact is on: clicks, scroll and typing go to the page. Esc releases the keyboard.'
                : 'Interact is off: you only look. Turn on to click and type in the page.'
          }
          onClick={toggleInteract}
        >
          <CursorClickIcon size={16} weight={interact ? 'fill' : 'bold'} aria-hidden="true" />
          Interact
          <span className="prepare-togglestate">{interact ? 'On' : 'Off'}</span>
        </button>
      </div>

      <div className="prepare-wrap">
        <div className="prepare-fit" ref={wrap}>
          {canvas && deck && stageSize.width > 0 && (
            <div
              ref={stage}
              className="prepare-stage"
              data-locked={String(!canSend)}
              data-tally={banner ?? 'idle'}
              // Focusable so the keyboard reaches the page; F6 leaves it.
              tabIndex={0}
              role="application"
              aria-label={`Preview of ${domain}. ${
                canSend
                  ? 'Interact is on: keys and clicks go to the page. Esc releases the keyboard. F6 moves to the address.'
                  : locked
                    ? 'Input is locked while on air.'
                    : `Interact is off: you only look. ${
                        lay.cropped ? 'Drag or scroll to move the page. ' : ''
                      }Turn on Interact to click and type.`
              }`}
              style={{
                width: stageSize.width,
                height: stageSize.height,
                cursor: stageCursor({
                  interact,
                  locked,
                  canPan: panReady,
                  panning,
                  page: nav?.cursor ?? 'default'
                })
              }}
              onFocus={() => setStageFocused(true)}
              onBlur={() => setStageFocused(false)}
              onMouseLeave={onMouseLeave}
              onMouseDown={onMouse}
              onMouseUp={onMouse}
              onMouseMove={onMouse}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={onKey}
              onKeyUp={onKey}
            >
              <div
                ref={page}
                className="prepare-page"
                style={{ left: pageLeft, top: pageTop, width: lay.width, height: lay.height }}
              >
                <StreamLayer
                  source="tab"
                  id={deckId}
                  poster={slideUrl(deckId, '001.png')}
                  paused={false}
                  canvas={canvas}
                  fps={PREVIEW_FPS}
                  muted
                  generation={generation}
                  onReady={() => undefined}
                />
              </div>
            </div>
          )}
          {canvas && mode === 'actual' && mapShown && (
            <PrepareMiniMap
              canvas={canvas}
              box={box}
              view={view}
              dpr={dpr}
              onPan={(v) => panTo(clampPan(canvas, box, v, dpr))}
            />
          )}
        </div>
      </div>
    </main>
  )
}
