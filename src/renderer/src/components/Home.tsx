import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FilmStripIcon,
  DotsThreeIcon,
  FunnelSimpleIcon,
  GlobeIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SquaresFourIcon,
  UploadSimpleIcon
} from '@phosphor-icons/react'
import type { EventMeta, EventSummary } from '../../../shared/types'
import type { ProgramState } from '../../../shared/program'
import { thumbUrl } from '../../../shared/ipc'
import { tally } from '../model'
import {
  eventSubLine,
  FILTER_LABEL,
  homeList,
  loadHomePrefs,
  saveHomePrefs,
  type HomeFilter,
  type HomePrefs,
  type HomeTab
} from '../home'
import { StatusTag } from './StatusTag'
import { BrandMark } from './BrandMark'
import { GettingStarted } from './GettingStarted'
import {
  currentStep,
  guideMode,
  loadGuideHidden,
  saveGuideHidden,
  tutorialSteps
} from '../tutorial'
import { onMenuKeyDown } from './menuNav'

interface Props {
  events: EventMeta[]
  summaries: EventSummary[]
  current: string | null
  /** Ids of the open tabs. */
  openIds: string[]
  program: ProgramState
  airEvent: string | null
  /** "Opening Keynote, slide 3" for the banner; null while it is being read. */
  airHeadline: string | null
  /** Settings hdmi.enabled; null while the settings are still being read. */
  hdmiEnabled: boolean | null
  /** A slide (not a Key visual or black) is on Program. */
  slideOnProgram: boolean
  onOpen(id: string): void
  onBack(): void
  onNew(): void
  onImport(): void
  onAddWeb(): void
  /** Archive or unarchive; resolves when main has answered (errors are shown by the caller). */
  onArchive(id: string, archived: boolean): void
}

const TABS: { id: HomeTab; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'all', label: 'All' },
  { id: 'archive', label: 'Archive' }
]
const FILTERS: HomeFilter[] = ['all', 'live', 'web', 'empty']
const FILTER_ITEM: Record<HomeFilter, string> = {
  all: 'All events',
  live: 'On air',
  web: 'With web pages',
  empty: 'No decks yet'
}

/**
 * Home: find, open or create an event. The console stays mounted behind it, so nothing on the
 * output changes. Console keys are paused here (App ignores them); N, I, W, / and Esc work.
 */
export function Home(p: Props): React.JSX.Element {
  const [prefs, setPrefs] = useState<HomePrefs>(() => loadHomePrefs(localStorage))
  const [query, setQuery] = useState('')
  // Home is mounted fresh each time it opens, so "now" is current enough for the sub lines.
  const [now] = useState(() => Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const filterBtn = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The card whose More menu is open (one at a time).
  const [moreFor, setMoreFor] = useState<string | null>(null)
  const moreMenu = useRef<HTMLDivElement>(null)
  const moreBtns = useRef(new Map<string, HTMLButtonElement>())
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const choose = (next: Partial<HomePrefs>): void => {
    const merged = { ...prefs, ...next }
    setPrefs(merged)
    saveHomePrefs(localStorage, merged)
  }

  const kind = tally(p.program)
  const onAir = kind !== 'idle' && p.airEvent !== null
  const airName = p.events.find((e) => e.id === p.airEvent)?.name ?? ''
  const hasEvents = p.events.length > 0
  const sums = useMemo(() => new Map(p.summaries.map((s) => [s.id, s])), [p.summaries])
  const list = useMemo(
    () =>
      homeList(p.events, p.summaries, {
        tab: prefs.tab,
        filter: prefs.filter,
        query,
        airEvent: p.airEvent,
        onAir
      }),
    [p.events, p.summaries, prefs.tab, prefs.filter, query, p.airEvent, onAir]
  )

  // The menu focuses its checked item, and closes on Esc (focus back to Filter) or a click away.
  const closeMenu = (restore: boolean): void => {
    setMenuOpen(false)
    if (restore) filterBtn.current?.focus()
  }
  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLElement>('[aria-checked=true]')?.focus()
    const away = (e: PointerEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || filterBtn.current?.contains(t)) return
      setMenuOpen(false)
    }
    addEventListener('pointerdown', away, true)
    return () => removeEventListener('pointerdown', away, true)
  }, [menuOpen])

  // The More menu focuses its first enabled item and closes on a click away.
  useEffect(() => {
    if (!moreFor) return
    moreMenu.current?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus()
    const away = (e: PointerEvent): void => {
      const t = e.target as Node
      if (moreMenu.current?.contains(t) || moreBtns.current.get(moreFor)?.contains(t)) return
      setMoreFor(null)
    }
    addEventListener('pointerdown', away, true)
    return () => removeEventListener('pointerdown', away, true)
  }, [moreFor])
  const closeMore = (restore: boolean): void => {
    const id = moreFor
    setMoreFor(null)
    if (restore && id) moreBtns.current.get(id)?.focus()
  }

  const { onBack, onNew, onImport, onAddWeb } = p
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      // A dialog (Settings, Add web page) owns the keyboard while it is open.
      if (document.querySelector('[role=dialog], dialog[open]')) return
      // The target, not the active element: a field that closes on this very key has already lost focus.
      const el = e.target as HTMLElement | null
      if (el === search.current) {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (search.current?.value) setQuery('')
          else search.current?.blur()
        }
        return
      }
      if (moreFor && (moreMenu.current?.contains(el) || el === moreBtns.current.get(moreFor))) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setMoreFor(null)
          moreBtns.current.get(moreFor)?.focus()
        }
        return
      }
      if (menuOpen && (menuRef.current?.contains(el) || el === filterBtn.current)) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setMenuOpen(false)
          filterBtn.current?.focus()
        }
        return
      }
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onBack()
        return
      }
      const k = e.key.toLowerCase()
      if (k === '/') {
        e.preventDefault()
        search.current?.focus()
      } else if (k === 'n') {
        e.preventDefault()
        onNew()
      } else if (k === 'i' && hasEvents) {
        e.preventDefault()
        onImport()
      } else if (k === 'w' && hasEvents) {
        e.preventDefault()
        onAddWeb()
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onBack, onNew, onImport, onAddWeb, hasEvents, menuOpen, moreFor])

  const onTabKey = (e: React.KeyboardEvent, at: number): void => {
    const to =
      e.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? TABS.length - 1
              : -1
    if (to < 0) return
    e.preventDefault()
    e.stopPropagation()
    choose({ tab: TABS[to].id })
    tabRefs.current[to]?.focus()
  }

  const clearAll = (): void => {
    setQuery('')
    choose({ filter: 'all' })
  }
  const [guideHidden, setGuideHidden] = useState(() => loadGuideHidden(localStorage))
  const hideGuide = (next: boolean): void => {
    setGuideHidden(next)
    saveGuideHidden(localStorage, next)
  }
  const steps = tutorialSteps({
    hasEvent: hasEvents,
    hasDecks: p.summaries.some((s) => s.deckCount > 0),
    hdmiEnabled: p.hdmiEnabled,
    slideOnProgram: p.slideOnProgram
  })
  const mode = guideMode(steps, guideHidden, p.events.length)
  const noEventReason = hasEvents ? undefined : 'Create an event first.'
  const q = query.trim()

  return (
    <section className="home" aria-label="Events home" data-testid="home">
      <div className="hwrap">
        {hasEvents && <h1 className="visually-hidden">Events</h1>}
        {!hasEvents && (
          <div className="hero">
            <p className="hero-kicker">Welcome to</p>
            <h1 className="hero-title">
              <BrandMark size={36} />
              <span>Bridgecast</span>
            </h1>
          </div>
        )}

        {onAir && (
          <div className="onair" role="status" data-testid="home-onair">
            <StatusTag kind={kind} variant="word" />
            <span className="msg">
              <b>{p.airHeadline ?? airName}</b>
              <i>{airName}</i>
            </span>
            <button className="btn primary" onClick={p.onBack} data-testid="home-back">
              Back to console
              <kbd>Esc</kbd>
            </button>
          </div>
        )}

        <div className="toolbar">
          <label className="bigsearch">
            <MagnifyingGlassIcon size={16} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              placeholder="Search events and decks…"
              aria-label="Search events and decks"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="home-search"
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
          <button className="btn primary" onClick={p.onNew} data-testid="home-new">
            <PlusIcon size={16} aria-hidden="true" />
            New event
            <kbd>N</kbd>
          </button>
          <button
            className="btn"
            disabled={!hasEvents}
            title={noEventReason}
            onClick={p.onImport}
            data-testid="home-import"
          >
            <UploadSimpleIcon size={16} aria-hidden="true" />
            Import slides
            <kbd>I</kbd>
          </button>
          <button
            className="btn"
            disabled={!hasEvents}
            title={noEventReason}
            onClick={p.onAddWeb}
            data-testid="home-web"
          >
            <GlobeIcon size={16} aria-hidden="true" />
            Add web page
            <kbd>W</kbd>
          </button>
        </div>

        {mode !== 'off' && (
          <GettingStarted steps={steps} mode={mode} onHide={() => hideGuide(true)} />
        )}

        <div className="lhead">
          <div className="ltabs" role="tablist" aria-label="Event lists">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                className="ltab"
                role="tab"
                aria-selected={prefs.tab === t.id}
                tabIndex={prefs.tab === t.id ? 0 : -1}
                onClick={() => choose({ tab: t.id })}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="lright">
            {mode === 'off' && guideHidden && currentStep(steps) !== null && (
              <button
                className="btn sm quiet"
                onClick={() => hideGuide(false)}
                data-testid="guide-show"
              >
                Show the guide again
              </button>
            )}
            <button
              ref={filterBtn}
              className="btn sm"
              id="home-filter"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-pressed={prefs.filter !== 'all'}
              onClick={() => setMenuOpen((o) => !o)}
              data-testid="home-filter"
            >
              <FunnelSimpleIcon size={14} aria-hidden="true" />
              {FILTER_LABEL[prefs.filter]}
            </button>
            <div className="seg vt" role="group" aria-label="View">
              <button
                aria-pressed={prefs.layout === 'grid'}
                aria-label="Grid view"
                title="Grid view"
                onClick={() => choose({ layout: 'grid' })}
              >
                <SquaresFourIcon size={16} aria-hidden="true" />
              </button>
              <button
                aria-pressed={prefs.layout === 'list'}
                aria-label="List view"
                title="List view"
                onClick={() => choose({ layout: 'list' })}
              >
                <ListIcon size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          {menuOpen && (
            <div
              ref={menuRef}
              className="menu"
              role="menu"
              aria-label="Filter events"
              onKeyDown={onMenuKeyDown}
            >
              {FILTERS.map((f) => (
                <button
                  key={f}
                  role="menuitemradio"
                  aria-checked={prefs.filter === f}
                  onClick={() => {
                    choose({ filter: f })
                    closeMenu(true)
                  }}
                >
                  <span className="rd" />
                  <span>{FILTER_ITEM[f]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className={prefs.layout === 'list' ? 'evgrid list' : 'evgrid'}
          role="tabpanel"
          data-testid="home-grid"
        >
          {list.length === 0 ? (
            <div className="empty" data-testid="home-empty">
              <p>
                {!hasEvents
                  ? 'No events yet. Create one to add decks.'
                  : q
                    ? `No events match “${q}”.`
                    : prefs.tab === 'archive'
                      ? 'No archived events.'
                      : 'No events here.'}
              </p>
              <div className="row2">
                {hasEvents && (q || prefs.filter !== 'all') && (
                  <button className="btn sm" onClick={clearAll}>
                    Clear search and filter
                  </button>
                )}
                <button className="btn primary sm" onClick={p.onNew}>
                  New event
                </button>
              </div>
            </div>
          ) : (
            list.map((ev) => {
              const s = sums.get(ev.id)
              const live = onAir && ev.id === p.airEvent
              const open = p.openIds.includes(ev.id)
              return (
                <div key={ev.id} className="evc">
                  <button
                    className="ev"
                    aria-label={`Open ${ev.name}`}
                    data-open={open}
                    data-live={live}
                    data-testid="home-card"
                    onClick={() => p.onOpen(ev.id)}
                  >
                    <div className="evp">
                      {s?.first ? (
                        <div className="pv">
                          <img
                            src={thumbUrl(s.first.deckId, s.first.file)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                          />
                          <span className="n">
                            {s.hasWeb ? <GlobeIcon size={12} aria-hidden="true" /> : s.deckCount}
                          </span>
                        </div>
                      ) : (
                        <span className="none">
                          <FilmStripIcon size={32} aria-hidden="true" />
                        </span>
                      )}
                    </div>
                    <div className="evf">
                      <h3>
                        {live && <StatusTag kind={kind} variant="word" />}
                        <span className="en">{ev.name}</span>
                      </h3>
                      <p>{eventSubLine(ev, s, now)}</p>
                    </div>
                  </button>
                  <button
                    ref={(el) => {
                      if (el) moreBtns.current.set(ev.id, el)
                      else moreBtns.current.delete(ev.id)
                    }}
                    className="evmore"
                    aria-label={`More actions for ${ev.name}`}
                    aria-haspopup="menu"
                    aria-expanded={moreFor === ev.id}
                    title="More actions"
                    data-testid="home-more"
                    onClick={() => setMoreFor((m) => (m === ev.id ? null : ev.id))}
                  >
                    <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />
                  </button>
                  {moreFor === ev.id && (
                    <div
                      ref={moreMenu}
                      className="menu evmenu"
                      role="menu"
                      aria-label={`Actions for ${ev.name}`}
                      onKeyDown={onMenuKeyDown}
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          closeMore(false)
                          p.onOpen(ev.id)
                        }}
                      >
                        Open
                      </button>
                      {ev.archived ? (
                        <button
                          role="menuitem"
                          data-testid="home-unarchive"
                          onClick={() => {
                            closeMore(true)
                            p.onArchive(ev.id, false)
                          }}
                        >
                          Unarchive
                        </button>
                      ) : (
                        <button
                          role="menuitem"
                          className={live ? 'has-note' : undefined}
                          disabled={live}
                          data-testid="home-archive"
                          onClick={() => {
                            closeMore(true)
                            p.onArchive(ev.id, true)
                          }}
                        >
                          Archive
                          {live && (
                            <span className="menu-note">
                              On air. Take a slide of another event first.
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <p className="keys">
          Space, F, B and K are paused here and work again in the console. N, I, W and Esc work on
          this page.
        </p>
      </div>
    </section>
  )
}
