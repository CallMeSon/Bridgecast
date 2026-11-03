import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CursorClickIcon,
  DotsThreeVerticalIcon,
  HouseSimpleIcon,
  MapTrifoldIcon,
  SignOutIcon,
  WarningIcon,
  XIcon
} from '@phosphor-icons/react'
import { slideUrl } from '../../shared/ipc'
import type { ProgramState } from '../../shared/program'
import type { DeckMeta } from '../../shared/types'
import {
  PAGE_ZOOMS,
  ZOOM_LIVE_REFUSED,
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
  toPrepareKey
} from './model'
import {
  addressShown,
  homeDisabled,
  inputLocked,
  keyRoute,
  nextInteract,
  stageCursor,
  zoomLabel
} from './prepare-ui'
import { PrepareMiniMap } from './components/PrepareMiniMap'
import { VIDEO_ONLY_FPS } from './stream'
import { centred, clampPan, layout, panBy, type View, type ViewMode } from './prepare-view'
import { useWebInteract } from './use-web-interact'

/**
 * The preview is for looking and clicking: video only at 30 fps (spec 3), the same as
 * every other video-only capture of the page (they share one, see VIDEO_ONLY_FPS).
 */
const PREVIEW_FPS = VIDEO_ONLY_FPS
const VIEW_KEY = 'prepare-view'
const MAP_KEY = 'prepare-map'
/** How long the "keyboard released" note stays in the status line. */
const RELEASED_MS = 4000
/** Main refused an input while Interact was on: the page is not taking input any more. */
const INTERACT_REFUSED =
  'Interact stopped: the page is not taking input. Turn on Interact again to continue.'

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
 * before it goes on air. Input reaches the page only with Interact on; main also
 * refuses it on air unless Interact is on there. On air without Interact the app
 * shortcuts work here instead, so a clicker never types into the page. This preview
 * never reports a frame to main: it can not open the ready gate.
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
  // Interact follows the deck's state (nextInteract). Going live or leaving air with it on turns
  // it off here, and main drops its switch too; a change of state is handled once.
  useEffect(() => {
    if (!banner || prevBanner.current === banner) return
    const prev = prevBanner.current
    prevBanner.current = banner
    const next = nextInteract(interact, prev, { kind: 'banner', banner })
    if (interact && !next) {
      api
        .setWebInteract(deckId, false)
        .catch((e: unknown) => console.warn('[prepare] interact off failed:', e))
    }
    if (next !== interact) setInteract(next)
  }, [api, banner, deckId, interact])
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

  // On air with Interact off: app shortcuts work here (a clicker presses Next). With Interact on
  // the keys belong to the page, so the shortcuts stand aside.
  useEffect(() => {
    if (!live || interact) return
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
  }, [api, live, interact])

  // Input reaches the page only with Interact on. Main refuses it while the deck is on air and
  // not frozen unless Interact is on there too: a refusal means the page is not taking input
  // any more, so Interact goes off and the operator is told why.
  const send = useCallback(
    (input: PrepareInput | null) => {
      if (!input) return
      api.webInput(deckId, input).then(
        (ok) => {
          if (ok) return
          setInteract(false)
          setAddressNote({ text: INTERACT_REFUSED, problem: false })
        },
        (e: unknown) => console.warn('[prepare] input failed:', e)
      )
    },
    [api, deckId]
  )
  // Interact on: the page takes clicks, wheel and keys (the hook). Off, or on air without it, the
  // stage only looks: a drag pans a cropped page and nothing reaches the page.
  const canSend = interact
  const locked = banner !== null && inputLocked(banner, interact)
  const web = useWebInteract({ active: canSend, page, send })
  // Off turns the switch off in main too; on air a press asks main first (it refuses otherwise).
  const turnOff = (): void => {
    web.release()
    setInteract(false)
    api
      .setWebInteract(deckId, false)
      .catch((e: unknown) => setAddressNote({ text: errorMessage(e), problem: true }))
  }
  // Done: stop Interact (so nothing keeps reaching a live page) and close this window.
  const done = (): void => {
    if (interact) turnOff()
    window.close()
  }
  const turnOn = (): void => {
    // Not on air (or frozen) main takes the input without its switch: only this window changes.
    if (banner !== 'live') {
      setInteract(true)
      return
    }
    api.setWebInteract(deckId, true).then(
      () => {
        setInteract(true)
        setAddressNote(null)
      },
      (err: unknown) => setAddressNote({ text: errorMessage(err), problem: true })
    )
  }
  const toggleInteract = (): void => (interact ? turnOff() : turnOn())
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

  const onMouse = (e: React.MouseEvent): void => {
    if (e.type === 'mousedown' && e.button === 0 && canvas && dragPans()) {
      e.preventDefault()
      panDrag.current = { x: e.clientX, y: e.clientY, view }
      setPanning(true)
      return
    }
    web.onMouse(e)
  }
  const onWheel = (e: React.WheelEvent): void => {
    // Interact off: the wheel pans a cropped page. Otherwise it scrolls the page.
    if (!canSend) {
      if (canvas && canPan) panTo(panBy(canvas, box, view, dpr, -e.deltaX / dpr, -e.deltaY / dpr))
      return
    }
    web.onWheel(e)
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
    // On air, Esc stops Interact; the page does not get the key.
    if (route === 'stop') {
      e.preventDefault()
      if (e.type === 'keydown') turnOff()
      return
    }
    if (route === 'release') {
      e.preventDefault()
      // Esc reaches the page once (it closes page dialogs), then the keyboard is given back.
      // The key-up lands on the button, so both halves are sent now.
      if (e.type === 'keydown') {
        web.onKey(e)
        send(
          toPrepareKey({
            type: 'keyup',
            key: e.key,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            metaKey: e.metaKey
          } as KeyboardEvent)
        )
        interactButton.current?.focus()
        setReleased(true)
        window.clearTimeout(releasedTimer.current)
        releasedTimer.current = window.setTimeout(() => setReleased(false), RELEASED_MS)
      }
      return
    }
    if (route === 'page') web.onKey(e)
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
    menu.current
      ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitem"]')
      ?.focus()
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

  const zoom = nav?.zoom ?? deck?.web?.zoom ?? 1
  const zoomText = zoomLabel(zoom)
  const chooseZoom = (z: number): void => {
    closeMenu(true)
    setAddressNote(null)
    // Main decides (live and not frozen is refused); its message shows in the note.
    run(api.setWebZoom(deckId, z))
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
                else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault()
                  const items = [
                    ...(menu.current?.querySelectorAll<HTMLElement>(
                      '[role^="menuitem"]:not(:disabled)'
                    ) ?? [])
                  ]
                  const at = items.indexOf(document.activeElement as HTMLElement)
                  const next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? items.length - 1
                        : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                  items[next]?.focus()
                }
              }}
            >
              <span className="menu-label" id="prepare-zoom-label">
                Page zoom (changes the output)
              </span>
              <div role="group" aria-labelledby="prepare-zoom-label">
                {PAGE_ZOOMS.map((z) => (
                  <button
                    key={z}
                    type="button"
                    role="menuitemradio"
                    aria-checked={zoom === z}
                    disabled={live}
                    title={live ? ZOOM_LIVE_REFUSED : undefined}
                    onClick={() => chooseZoom(z)}
                  >
                    <span className="chk">
                      {zoom === z && <CheckIcon size={16} weight="bold" aria-hidden="true" />}
                    </span>
                    {Math.round(z * 100)}%
                  </button>
                ))}
              </div>
              <hr />
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
        {zoomText && (
          <span
            className="prepare-zoomlabel"
            title="The zoom changes the page itself, so the output shows it too."
          >
            <WarningIcon size={16} weight="bold" aria-hidden="true" />
            {zoomText}
            <span className="visually-hidden">. It changes the output.</span>
          </span>
        )}
        <button
          ref={interactButton}
          type="button"
          className="prepare-togglebtn prepare-interact"
          aria-pressed={interact}
          title={
            interact
              ? live
                ? 'Interact is on: your clicks reach the audience. Esc stops.'
                : 'Interact is on: clicks, scroll and typing go to the page. Esc releases the keyboard.'
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
                  ? live
                    ? 'Interact is on: your clicks reach the audience. Press Esc to stop.'
                    : 'Interact is on: keys and clicks go to the page. Esc releases the keyboard. F6 moves to the address.'
                  : `Interact is off: you only look. ${
                      lay.cropped ? 'Drag or scroll to move the page. ' : ''
                    }${live ? 'On air: turn on Interact to click and type.' : 'Turn on Interact to click and type.'}`
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
              onMouseLeave={web.onMouseLeave}
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
      <div className="prepare-footer">
        <button type="button" className="btn primary" data-testid="prepare-done" onClick={done}>
          Done
        </button>
      </div>
    </main>
  )
}
