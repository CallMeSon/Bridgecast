import type { Library } from './library'
import type { DeckMeta, EventMeta, SectionMeta } from '../shared/types'
import type { OrderItem } from '../shared/sections'
import { kvImageUrl } from '../shared/ipc'
import { DEFAULT_CANVAS, resolveCanvas, type Canvas } from '../shared/canvas'
import {
  followSlideOrder,
  initialState,
  kvOnAir,
  locateShown,
  reconcile,
  reduce,
  webKey,
  type Action,
  type ProgramState
} from '../shared/program'

type Position = { deckId: string | null; index: number }

function same(a: ProgramState, b: ProgramState): boolean {
  return (
    a.deckId === b.deckId &&
    a.index === b.index &&
    a.frozen === b.frozen &&
    a.black === b.black &&
    a.kv === b.kv &&
    a.kvUrl === b.kvUrl &&
    a.transition === b.transition &&
    a.autoAdvance === b.autoAdvance &&
    a.take === b.take &&
    a.webHold === b.webHold &&
    a.canvas.width === b.canvas.width &&
    a.canvas.height === b.canvas.height &&
    a.canvas.origin === b.canvas.origin &&
    a.shown?.fit === b.shown?.fit &&
    a.shown?.audio?.volume === b.shown?.audio?.volume &&
    a.shown?.audio?.muted === b.shown?.audio?.muted &&
    a.shown?.video === b.shown?.video &&
    a.shown?.deckId === b.shown?.deckId &&
    a.shown?.index === b.shown?.index &&
    a.shown?.step === b.shown?.step &&
    a.shown?.playback === b.shown?.playback &&
    a.shown?.file === b.shown?.file &&
    a.shown?.web?.deckId === b.shown?.web?.deckId
  )
}

/**
 * Holds the active event and the Program state. The operator position always
 * belongs to the active event; `shown` (what is on the output) may still point
 * at a deck of another event and is only cleared when that slide disappears.
 */
export class AppState {
  private current: ProgramState
  private activeEvent: string | null
  private listeners: ((s: ProgramState) => void)[] = []
  private positions = new Map<string, Position>()

  /**
   * @param autoAdvance saved setting (settings.json) restored at start.
   * @param machineCanvas the machine default canvas, read each time so a changed
   *   setting applies on the next `refresh()`.
   * @param webReady ready gate of a web deck (page loaded and a first capture
   *   frame seen); a take that would put a not-ready web deck on air is refused.
   * @param forwardKey sends Next/Prev to the live web page as one arrow key.
   * @param engineReady the native slideshow of a deck is open and ready; a take of a
   *   native deck while it is not plays that take as images (never black, never desktop).
   */
  constructor(
    private lib: Library,
    autoAdvance = false,
    private machineCanvas: () => Canvas = () => DEFAULT_CANVAS,
    private webReady: (deckId: string) => boolean = () => true,
    private forwardKey: (deckId: string, key: 'ArrowRight' | 'ArrowLeft') => void = () => {},
    private engineReady: (deckId: string) => boolean = () => true
  ) {
    this.activeEvent = lib.listEvents()[0]?.id ?? null
    this.current = this.normalize({ ...initialState, autoAdvance })
  }

  get state(): ProgramState {
    return this.current
  }

  get eventId(): string | null {
    return this.activeEvent
  }

  decks(): DeckMeta[] {
    return this.activeEvent ? this.lib.getDecks(this.activeEvent) : []
  }

  /** Sections of the active event (none without an event). */
  sections(): SectionMeta[] {
    return this.lib.listEvents().find((e) => e.id === this.activeEvent)?.sections ?? []
  }

  onChange(cb: (s: ProgramState) => void): void {
    this.listeners.push(cb)
  }

  dispatch(a: Action): ProgramState {
    const decks = this.decks()
    // A live web page owns Next/Prev: one press is one arrow key, the position never moves.
    const key = webKey(this.current, decks, a)
    if (key && this.current.shown) {
      this.forwardKey(this.current.shown.deckId, key)
      return this.current
    }
    // Actions arrive over IPC; an unknown type makes reduce return undefined.
    let next = reduce(this.current, a, decks, this.sections()) as ProgramState | undefined
    if (!next) return this.current
    // Engine gate: a native slide taken while the engine is not ready plays as images.
    const nat = next.shown
    if (
      nat &&
      nat.playback === 'native' &&
      nat !== this.current.shown &&
      a.type !== 'enginePosition' &&
      !this.engineReady(nat.deckId)
    ) {
      if (a.type === 'resumeNative') return this.current
      next = { ...next, shown: { ...nat, playback: 'images', step: 0 } }
    }
    // Ready gate: a web page goes on air only once it is loaded and a frame was captured.
    const web = next.shown?.web
    if (web && next.shown !== this.current.shown && !this.webReady(web.deckId)) {
      return this.current
    }
    // K or B going off would show the web page again: only when it is ready (after HOLD the
    // output never returns to a failed page by itself, and the ready gate covers this too).
    const hidden = (x: ProgramState): boolean => x.black || kvOnAir(x)
    if (web && hidden(this.current) && !hidden(next) && !this.webReady(web.deckId)) {
      return this.current
    }
    // Resume web only once the page has recovered.
    const held = this.current.shown?.web
    if (a.type === 'resumeWeb' && held && !this.webReady(held.deckId)) return this.current
    return this.commit(this.normalizeKv(next))
  }

  /**
   * HOLD: the live web page failed; the output keeps its last good frame. Only
   * main sets it, and only while a web deck is on air; it never ends by itself.
   */
  setWebHold(on: boolean): ProgramState {
    if (on && !this.current.shown?.web) return this.current
    return this.commit({ ...this.current, webHold: on })
  }

  /** Switch the active event. `shown` is never changed here (spec: output stays until the operator picks a slide). */
  setEvent(eventId: string): ProgramState {
    this.lib.getDecks(eventId) // throws (user-facing message) if the event does not exist
    if (this.activeEvent) {
      this.positions.set(this.activeEvent, {
        deckId: this.current.deckId,
        index: this.current.index
      })
    }
    this.activeEvent = eventId
    const pos = this.positions.get(eventId) ?? { deckId: null, index: 0 }
    return this.commit(this.normalize({ ...this.current, ...pos }))
  }

  /** Re-validate after the library changed (deck added, removed or reordered). */
  refresh(): ProgramState {
    return this.commit(this.normalize(this.current))
  }

  /** Reorder the decks and section dividers of an event; position and shown do not change. */
  reorder(eventId: string, items: OrderItem[]): ProgramState {
    this.lib.reorder(eventId, items)
    return this.refresh()
  }

  addSection(eventId: string, at: number | 'end'): { event: EventMeta; sectionId: string } {
    return this.lib.addSection(eventId, at)
  }

  renameSection(eventId: string, sectionId: string, name: string): EventMeta {
    return this.lib.renameSection(eventId, sectionId, name)
  }

  removeSection(eventId: string, sectionId: string): EventMeta {
    return this.lib.removeSection(eventId, sectionId)
  }

  /**
   * Reorder the slides of a deck (`order[newIndex] = oldIndex`). The operator
   * position and the output stay on the same slides: `shown` keeps its image,
   * only its index changes.
   */
  reorderSlides(deckId: string, order: number[]): ProgramState {
    this.lib.reorderSlides(deckId, order) // validates; throws before anything changes
    for (const [ev, pos] of this.positions) {
      if (pos.deckId === deckId) {
        this.positions.set(ev, { ...pos, index: Math.max(0, order.indexOf(pos.index)) })
      }
    }
    return this.commit(this.normalize(followSlideOrder(this.current, deckId, order)))
  }

  /** URL of an event's stored KV, or null. */
  private kvUrlOf(eventId: string): string | null {
    const ev = this.lib.listEvents().find((e) => e.id === eventId)
    return ev?.kv ? kvImageUrl(ev.id, ev.kv) : null
  }

  /**
   * Set an event's KV image. The KV on air keeps its image when another event
   * changes; replacing the very image on air puts the new one on air.
   */
  setKv(eventId: string, srcPath: string): EventMeta {
    const before = this.kvUrlOf(eventId)
    const ev = this.lib.setKv(eventId, srcPath)
    const onAir = before !== null && before === this.current.kvUrl && kvOnAir(this.current)
    this.commit(
      this.normalize(onAir ? { ...this.current, kvUrl: kvImageUrl(eventId, ev.kv!) } : this.current)
    )
    return ev
  }

  /**
   * Remove an event's KV. If that image is on air the KV goes off; at STANDBY
   * the output becomes black instead of silently showing something else.
   */
  clearKv(eventId: string): EventMeta {
    const before = this.kvUrlOf(eventId)
    const ev = this.lib.clearKv(eventId)
    let s = this.current
    if (before !== null && before === s.kvUrl && kvOnAir(s)) {
      s = { ...s, kv: false, black: s.shown === null ? true : s.black, kvUrl: null }
    }
    this.commit(this.normalize(s))
    return ev
  }

  /** Remove a deck; if it is on the output, the output goes black. */
  removeDeck(eventId: string, deckId: string): ProgramState {
    this.lib.removeDeck(eventId, deckId)
    return this.refresh()
  }

  /** `shown` re-located in its deck (any event), or null when that slide is gone. */
  private locate(s: ProgramState): ProgramState['shown'] {
    if (!s.shown) return null
    try {
      return locateShown(s.shown, this.lib.getDeck(s.shown.deckId))
    } catch {
      return null
    }
  }

  /** URL of the active event's KV, or null (no event, no KV). */
  private activeKvUrl(): string | null {
    const ev = this.lib.listEvents().find((e) => e.id === this.activeEvent)
    return ev?.kv ? kvImageUrl(ev.id, ev.kv) : null
  }

  /** The active event's canvas override, else the machine default. */
  private activeCanvas(): ProgramState['canvas'] {
    const ev = this.lib.listEvents().find((e) => e.id === this.activeEvent)
    return resolveCanvas(ev?.canvas, this.machineCanvas())
  }

  private normalize(s: ProgramState): ProgramState {
    // Position is reconciled against the active event only; if no valid deck,
    // reconcile moves it to the first ready deck at index 0 (no selectDeck, so
    // `shown` stays untouched).
    const pos = reconcile({ ...s, shown: null }, this.decks())
    // The KV belongs to the active event; KV on needs one (a removed KV turns it off).
    // The KV on air keeps its image when the event changes; otherwise the
    // active event's KV is applied.
    const kvUrl = kvOnAir(s) ? s.kvUrl : this.activeKvUrl()
    const shown = this.locate(s)
    return {
      ...pos,
      shown,
      // A hold belongs to a web page on air; it goes when that page leaves the output.
      webHold: s.webHold && !!shown?.web,
      kvUrl,
      kv: s.kv && kvUrl !== null,
      canvas: this.activeCanvas()
    }
  }

  /**
   * After a dispatch: once the KV is no longer on air, apply the active event's
   * KV. The canvas is re-resolved too, so it is right even if the machine
   * default changed since the last `refresh()`.
   */
  private normalizeKv(s: ProgramState): ProgramState {
    const withCanvas = { ...s, canvas: this.activeCanvas() }
    if (kvOnAir(withCanvas)) return withCanvas
    const kvUrl = this.activeKvUrl()
    return kvUrl === withCanvas.kvUrl
      ? withCanvas
      : { ...withCanvas, kvUrl, kv: withCanvas.kv && kvUrl !== null }
  }

  private commit(next: ProgramState): ProgramState {
    if (same(next, this.current)) return this.current
    this.current = next
    for (const cb of this.listeners) cb(next)
    return next
  }
}
