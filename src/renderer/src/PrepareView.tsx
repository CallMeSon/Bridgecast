import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DotsThreeVerticalIcon,
  SignOutIcon
} from '@phosphor-icons/react'
import { slideUrl } from '../../shared/ipc'
import type { ProgramState } from '../../shared/program'
import type { DeckMeta } from '../../shared/types'
import { sanitizeWebUrl, webDomain, type PrepareInput, type WebStatus } from '../../shared/web'
import { StreamLayer } from './components/StreamLayer'
import {
  errorMessage,
  keyToAction,
  prepareBanner,
  prepareBannerText,
  toPrepareChar,
  toPrepareInput
} from './model'
import { stageRect } from './stage'

/** The preview is for looking and clicking: video only at 30 fps (spec 3). */
const PREVIEW_FPS = 30
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })

  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const urlField = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const addressEdited = useRef(false)

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
        if (found?.web && !addressEdited.current) setAddress(found.web.url)
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
    document.title = deck ? `Prepare: ${deck.name}` : 'Prepare web page'
  }, [deck])

  const banner = program ? prepareBanner(program, deckId) : null
  const live = banner === 'live'
  const canvas = program?.canvas
  const size = canvas ? stageRect(canvas, box) : { width: 0, height: 0, left: 0, top: 0 }

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
  const canSend = banner === 'idle' || banner === 'frozen'
  const stageBox = (): DOMRect | null => stage.current?.getBoundingClientRect() ?? null

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
    if (!canSend) return
    const r = stageBox()
    if (!r) return
    if (e.type === 'mousemove') {
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
  const onWheel = (e: React.WheelEvent): void => {
    const r = stageBox()
    if (canSend && r) send(toPrepareInput(e.nativeEvent, r))
  }
  const onKey = (e: React.KeyboardEvent): void => {
    // F6 moves focus out of the page, so the keyboard is never trapped in the preview.
    if (e.key === 'F6') {
      e.preventDefault()
      urlField.current?.focus()
      return
    }
    if (!canSend) return
    const r = stageBox()
    if (!r) return
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
        addressEdited.current = false
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
          title={live ? 'Back (locked while on air)' : 'Back'}
          disabled={live}
          onClick={() => run(api.navWeb(deckId, 'back'))}
        >
          <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn sm prepare-icon"
          aria-label="Forward"
          title={live ? 'Forward (locked while on air)' : 'Forward'}
          disabled={live}
          onClick={() => run(api.navWeb(deckId, 'forward'))}
        >
          <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn sm prepare-icon"
          aria-label="Reload"
          title={live ? 'Reload (on air: the output goes to HOLD first)' : 'Reload'}
          onClick={() => run(api.reloadWeb(deckId))}
        >
          <ArrowClockwiseIcon size={16} weight="bold" aria-hidden="true" />
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
            value={address}
            disabled={live}
            aria-describedby={addressNote ? 'prepare-note' : undefined}
            onChange={(e) => {
              addressEdited.current = true
              setAddress(e.target.value)
              setAddressNote(null)
            }}
          />
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
        {banner && <span>{prepareBannerText(banner)}</span>}
      </div>

      {failure && (
        <p className="prepare-note problem" role="alert">
          {failure}
        </p>
      )}

      <div className="prepare-wrap">
        <div className="prepare-fit" ref={wrap}>
          {canvas && deck && size.width > 0 && (
            <div
              ref={stage}
              className="prepare-stage"
              data-locked={String(!canSend)}
              // Focusable so the keyboard reaches the page; F6 leaves it.
              tabIndex={0}
              role="application"
              aria-label={`Preview of ${domain}. ${
                canSend ? 'Keys and clicks go to the page. F6 leaves the page.' : 'Input is locked.'
              }`}
              style={{ width: size.width, height: size.height }}
              onMouseDown={onMouse}
              onMouseUp={onMouse}
              onMouseMove={onMouse}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={onKey}
              onKeyUp={onKey}
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
          )}
        </div>
      </div>
      <p className="prepare-hint">
        {canSend
          ? 'Click the page, then type. F6 moves focus to the address.'
          : 'Next, Previous and the other shortcuts work here while the page is on air.'}
      </p>
    </main>
  )
}
