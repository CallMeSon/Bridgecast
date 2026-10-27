import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  DECK_NAME_MAX,
  KV_FILE_RE,
  KV_MAX_BYTES,
  KV_MIME,
  type DeckMeta,
  type EventMeta,
  type SectionMeta
} from '../shared/types'
import { CANVAS_INVALID, isDeckFit, sanitizeCanvas } from '../shared/canvas'
import { sanitizeDeckAudio } from '../shared/audio-levels'
import { sanitizeSections, splitOrder, type OrderItem } from '../shared/sections'
import { sanitizeWebUrl } from '../shared/web'
import { thumbFileName } from './slide-protocol'
import { writeThumbnail } from './thumbnail'

type DeckInput = {
  name: string
  source: 'pptx' | 'pdf' | 'folder'
  width: number
  height: number
  slides: { pngPath: string; notes: string; videoPath?: string }[]
}

type WebDeckInput = {
  name: string
  url: string
  /** PNG of the page (or a placeholder) stored as the deck's one slide. */
  snapshotPath: string
  width: number
  height: number
}

const NOT_WEB = 'This deck is not a web page. Choose a web deck from the list.'

/** The cleaned URL, or the user-facing error (`sanitizeWebUrl`) thrown. */
function cleanWebUrl(url: unknown): string {
  const res = sanitizeWebUrl(typeof url === 'string' ? url : '')
  if ('error' in res) throw new Error(res.error)
  return res.url
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const slideName = (i: number, ext = 'png'): string => `${String(i + 1).padStart(3, '0')}.${ext}`

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export { DECK_NAME_MAX }

/** Copy of an event that shares no arrays with the stored one. */
function copyEvent(ev: EventMeta): EventMeta {
  const copy: EventMeta = { ...ev, deckIds: [...ev.deckIds] }
  if (ev.sections) copy.sections = ev.sections.map((s) => ({ ...s }))
  if (ev.canvas) copy.canvas = { ...ev.canvas }
  return copy
}

/** Writes a thumbnail image of `src` to `dest`; throws on failure. */
export type ThumbWriter = (src: string, dest: string) => void

export class Library {
  private events: EventMeta[]
  /** Thumbnails being generated, by thumbnail path (one job per file). */
  private thumbJobs = new Map<string, Promise<boolean>>()

  constructor(
    private root: string,
    private makeThumb: ThumbWriter = writeThumbnail
  ) {
    fs.mkdirSync(path.join(root, 'decks'), { recursive: true })
    this.events = this.loadEvents()
  }

  private get eventsFile(): string {
    return path.join(this.root, 'events.json')
  }

  private deckDir(deckId: string): string {
    if (!UUID_RE.test(deckId)) {
      throw new Error('The deck ID is not valid. Reload the deck list, then choose a deck from it.')
    }
    return path.join(this.root, 'decks', deckId)
  }

  private loadEvents(): EventMeta[] {
    if (!fs.existsSync(this.eventsFile)) return []
    try {
      const events = JSON.parse(fs.readFileSync(this.eventsFile, 'utf8')) as EventMeta[]
      for (const ev of events) {
        if (ev.sections) {
          ev.sections = sanitizeSections(ev.sections, ev.deckIds.length)
            .map((s) => ({ ...s, name: s.name.trim() }))
            .filter((s) => s.name !== '')
        }
        // An older or damaged file must not break loading: drop what is not a valid canvas.
        if ('canvas' in ev) {
          const canvas = sanitizeCanvas(ev.canvas)
          if (canvas) ev.canvas = canvas
          else delete ev.canvas
        }
      }
      return events
    } catch {
      throw new Error(
        'events.json is damaged and cannot be read. Restore it from a backup, or delete the file to start over.'
      )
    }
  }

  private saveEvents(): void {
    writeJsonAtomic(this.eventsFile, this.events)
  }

  private findEvent(eventId: string): EventMeta {
    const ev = this.events.find((e) => e.id === eventId)
    if (!ev)
      throw new Error('Event not found. Choose another event from the menu, or create a new one.')
    return ev
  }

  private readDeck(deckId: string): DeckMeta {
    const file = path.join(this.deckDir(deckId), 'deck.json')
    if (!fs.existsSync(file))
      throw new Error('Deck not found. Reload the deck list, or import the deck again.')
    const deck = JSON.parse(fs.readFileSync(file, 'utf8')) as DeckMeta
    // Fields added after the first release: keep only valid values, never throw on old or damaged files.
    const { fit, audio, web } = deck
    delete deck.fit
    delete deck.audio
    delete deck.web
    if (isDeckFit(fit)) deck.fit = fit
    if (typeof audio === 'object' && audio !== null && !Array.isArray(audio)) {
      deck.audio = sanitizeDeckAudio(audio)
    }
    if (
      typeof web === 'object' &&
      web !== null &&
      typeof (web as { url?: unknown }).url === 'string'
    ) {
      deck.web = { url: (web as { url: string }).url }
    }
    return deck
  }

  private writeDeck(deck: DeckMeta): void {
    writeJsonAtomic(path.join(this.deckDir(deck.id), 'deck.json'), deck)
  }

  createEvent(name: string): EventMeta {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Event name is empty. Type a name for the event.')
    const ev: EventMeta = { id: randomUUID(), name: trimmed, deckIds: [] }
    this.events.push(ev)
    this.saveEvents()
    return copyEvent(ev)
  }

  listEvents(): EventMeta[] {
    return this.events.map(copyEvent)
  }

  getDecks(eventId: string): DeckMeta[] {
    return this.findEvent(eventId).deckIds.map((id) => this.readDeck(id))
  }

  addDeck(eventId: string, d: DeckInput): DeckMeta {
    return this.storeDeck(eventId, d)
  }

  /**
   * Adds a web deck: one slide `001.png` (the page snapshot, refreshed later by
   * `updateWebSnapshot`) and the page URL, cleaned by `sanitizeWebUrl`.
   */
  addWebDeck(eventId: string, d: WebDeckInput): DeckMeta {
    const url = cleanWebUrl(d.url)
    return this.storeDeck(
      eventId,
      {
        name: d.name,
        source: 'web',
        width: d.width,
        height: d.height,
        slides: [{ pngPath: d.snapshotPath, notes: '' }]
      },
      { url }
    )
  }

  /** Changes the page of a web deck; the URL is cleaned like a new one. */
  setWebUrl(eventId: string, deckId: string, url: string): DeckMeta {
    const current = this.deckInEvent(eventId, deckId)
    if (current.source !== 'web') throw new Error(NOT_WEB)
    const deck = { ...current, web: { url: cleanWebUrl(url) } }
    this.writeDeck(deck)
    return deck
  }

  /**
   * Replaces the snapshot (`001.png`) of a web deck and its thumbnail. The file
   * name stays, so a renderer showing it must reload the image itself.
   */
  updateWebSnapshot(deckId: string, pngPath: string): void {
    const deck = this.readDeck(deckId)
    if (deck.source !== 'web' || !deck.slides[0]) throw new Error(NOT_WEB)
    const dir = this.deckDir(deckId)
    const file = deck.slides[0].file
    const tmp = path.join(dir, `${file}.${randomUUID()}.tmp`)
    try {
      fs.copyFileSync(pngPath, tmp)
      fs.renameSync(tmp, path.join(dir, file))
    } catch (err) {
      fs.rmSync(tmp, { force: true })
      throw err
    }
    // Drop the old thumbnail and any finished job for it, so the next request makes a new one.
    const thumb = this.thumbPath(deckId, file)
    this.thumbJobs.delete(thumb)
    fs.rmSync(thumb, { force: true })
    void this.ensureThumb(deckId, file)
  }

  private storeDeck(
    eventId: string,
    d: Omit<DeckInput, 'source'> & { source: DeckMeta['source'] },
    web?: { url: string }
  ): DeckMeta {
    const ev = this.findEvent(eventId)
    const id = randomUUID()
    const dir = this.deckDir(id)
    fs.mkdirSync(dir, { recursive: true })
    try {
      const slides = d.slides.map((s, i) => {
        const file = slideName(i)
        fs.copyFileSync(s.pngPath, path.join(dir, file))
        if (!s.videoPath) return { file, notes: s.notes }
        // The video shares its number with the poster (003.png / 003.mp4).
        const video = slideName(i, 'mp4')
        fs.copyFileSync(s.videoPath, path.join(dir, video))
        return { file, notes: s.notes, video }
      })
      const deck: DeckMeta = {
        id,
        name: d.name,
        source: d.source,
        width: d.width,
        height: d.height,
        slides
      }
      if (web) deck.web = web
      this.writeDeck(deck)
      ev.deckIds.push(id)
      this.saveEvents()
      void this.generateThumbs(deck)
      return deck
    } catch (err) {
      ev.deckIds = ev.deckIds.filter((x) => x !== id)
      fs.rmSync(dir, { recursive: true, force: true })
      throw err
    }
  }

  /** Sets the order of decks and sections. `items` must be exactly the event's decks and sections, once each. */
  reorder(eventId: string, items: OrderItem[]): void {
    const ev = this.findEvent(eventId)
    const sections = ev.sections ?? []
    const keys = Array.isArray(items)
      ? items.map((it) =>
          typeof it === 'object' && it !== null
            ? 'deck' in it
              ? `d:${String(it.deck)}`
              : `s:${String((it as { section: unknown }).section)}`
            : ''
        )
      : []
    const expected = new Set([
      ...ev.deckIds.map((id) => `d:${id}`),
      ...sections.map((x) => `s:${x.id}`)
    ])
    const valid =
      Array.isArray(items) &&
      keys.length === expected.size &&
      new Set(keys).size === keys.length &&
      keys.every((k) => expected.has(k))
    if (!valid) {
      throw new Error('The deck list changed meanwhile. It has been reloaded; try the move again.')
    }
    const next = splitOrder(items, sections)
    const prevIds = ev.deckIds
    const prevSections = ev.sections
    ev.deckIds = next.deckIds
    if (ev.sections) ev.sections = next.sections
    try {
      this.saveEvents()
    } catch (err) {
      ev.deckIds = prevIds
      ev.sections = prevSections
      if (prevSections === undefined) delete ev.sections
      throw err
    }
  }

  /** Validates a section name like a deck name; returns the trimmed name. */
  private sectionName(name: unknown): string {
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('Section name is empty. Type a name, for example "Opening".')
    if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) {
      throw new Error('Section name contains unsupported characters. Retype the name.')
    }
    if ([...trimmed].length > DECK_NAME_MAX) {
      throw new Error(`Section name is too long. Use ${DECK_NAME_MAX} characters or fewer.`)
    }
    return trimmed
  }

  private findSection(ev: EventMeta, sectionId: string): SectionMeta {
    const sec = ev.sections?.find((x) => x.id === sectionId)
    if (!sec) throw new Error('Section not found. Reload the app, then try again.')
    return sec
  }

  /**
   * Adds a divider before `deckIds[at]` (`at === length` appends), after sections already at
   * `at`. `'end'` means after the last deck as stored now, whatever the caller last saw.
   */
  addSection(
    eventId: string,
    position: number | 'end',
    name?: string
  ): { event: EventMeta; sectionId: string } {
    const ev = this.findEvent(eventId)
    const at = position === 'end' ? ev.deckIds.length : position
    if (!Number.isInteger(at) || at < 0 || at > ev.deckIds.length) {
      throw new Error('The section position is not valid. Reload the app, then try again.')
    }
    const sections = ev.sections ?? []
    const clean = name === undefined ? `Section ${sections.length + 1}` : this.sectionName(name)
    const section: SectionMeta = { id: randomUUID(), name: clean, at }
    // Array order is display order: insert after every section at or before `at`.
    const next = [...sections]
    let i = next.length
    while (i > 0 && next[i - 1].at > at) i--
    next.splice(i, 0, section)
    this.commitSections(ev, next)
    return { event: copyEvent(ev), sectionId: section.id }
  }

  renameSection(eventId: string, sectionId: string, name: string): EventMeta {
    const ev = this.findEvent(eventId)
    const sec = this.findSection(ev, sectionId)
    const clean = this.sectionName(name)
    this.commitSections(
      ev,
      (ev.sections ?? []).map((x) => (x === sec ? { ...x, name: clean } : x))
    )
    return copyEvent(ev)
  }

  removeSection(eventId: string, sectionId: string): EventMeta {
    const ev = this.findEvent(eventId)
    this.findSection(ev, sectionId)
    this.commitSections(
      ev,
      (ev.sections ?? []).filter((x) => x.id !== sectionId)
    )
    return copyEvent(ev)
  }

  /** Stores `sections` on the event and saves; restores the previous value if saving fails. */
  private commitSections(ev: EventMeta, sections: SectionMeta[]): void {
    const previous = ev.sections
    ev.sections = sections
    try {
      this.saveEvents()
    } catch (err) {
      ev.sections = previous
      if (previous === undefined) delete ev.sections
      throw err
    }
  }

  reorderSlides(deckId: string, order: number[]): void {
    const deck = this.readDeck(deckId)
    const n = deck.slides.length
    const valid =
      order.length === n &&
      new Set(order).size === n &&
      order.every((i) => Number.isInteger(i) && i >= 0 && i < n)
    if (!valid) {
      throw new Error(
        'The slide order is not valid: it must list every slide exactly once. Reload the app, then try again.'
      )
    }
    // File PNG tetap; hanya urutan di deck.json yang berubah (satu rename atomik).
    const slides = order.map((from) => deck.slides[from])
    this.writeDeck({ ...deck, slides })
  }

  /** Display name only (e.g. "Sesi 1 - Pengenalan materi"); slides and files stay. */
  renameDeck(eventId: string, deckId: string, name: string): DeckMeta {
    const ev = this.findEvent(eventId)
    if (!ev.deckIds.includes(deckId)) {
      throw new Error(
        'Deck not found in this event. Reload the deck list, then choose a deck from it.'
      )
    }
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed)
      throw new Error('Deck name is empty. Type a name, for example "Session 1: Opening".')
    if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) {
      throw new Error('Deck name contains unsupported characters. Retype the name.')
    }
    if ([...trimmed].length > DECK_NAME_MAX) {
      throw new Error(`Deck name is too long. Use ${DECK_NAME_MAX} characters or fewer.`)
    }
    const deck = { ...this.readDeck(deckId), name: trimmed }
    this.writeDeck(deck)
    return deck
  }

  /** Deck belonging to the event, or the standard "not found in this event" error. */
  private deckInEvent(eventId: string, deckId: string): DeckMeta {
    const ev = this.findEvent(eventId)
    if (!ev.deckIds.includes(deckId)) {
      throw new Error(
        'Deck not found in this event. Reload the deck list, then choose a deck from it.'
      )
    }
    return this.readDeck(deckId)
  }

  /** How this deck's slides fill the canvas. Rejects anything but fit, fill or stretch. */
  setDeckFit(eventId: string, deckId: string, fit: unknown): DeckMeta {
    const current = this.deckInEvent(eventId, deckId)
    if (!isDeckFit(fit)) {
      throw new Error('The display mode is not valid. Choose Fit, Fill or Stretch.')
    }
    const deck = { ...current, fit }
    this.writeDeck(deck)
    return deck
  }

  /** Sound level of this deck's videos; stored sanitized (volume 0–100, muted flag). */
  setDeckAudio(eventId: string, deckId: string, audio: unknown): DeckMeta {
    const current = this.deckInEvent(eventId, deckId)
    const deck = { ...current, audio: sanitizeDeckAudio(audio) }
    this.writeDeck(deck)
    return deck
  }

  /** Canvas override for one event; `null` removes it so the machine default applies again. */
  setEventCanvas(eventId: string, canvas: unknown | null): EventMeta {
    const ev = this.findEvent(eventId)
    if (canvas === null) {
      delete ev.canvas
    } else {
      const clean = sanitizeCanvas(canvas)
      if (!clean) throw new Error(CANVAS_INVALID)
      ev.canvas = clean
    }
    this.saveEvents()
    return copyEvent(ev)
  }

  removeDeck(eventId: string, deckId: string): void {
    const ev = this.findEvent(eventId)
    if (!ev.deckIds.includes(deckId)) {
      throw new Error(
        'Deck not found in this event. Reload the deck list, then choose a deck from it.'
      )
    }
    const index = ev.deckIds.indexOf(deckId)
    ev.deckIds = ev.deckIds.filter((id) => id !== deckId)
    if (ev.sections) {
      ev.sections = ev.sections.map((x) => (x.at > index ? { ...x, at: x.at - 1 } : x))
    }
    this.saveEvents()
    fs.rmSync(this.deckDir(deckId), { recursive: true, force: true })
  }

  private kvDir(eventId: string): string {
    // Event ids are uuids we generated; refuse anything else before using it as a folder name.
    if (!UUID_RE.test(eventId)) {
      throw new Error(
        'The event ID is not valid. Reload the app, then choose an event from the menu.'
      )
    }
    return path.join(this.root, 'kv', eventId)
  }

  /**
   * Set the event's KV (key visual, shown on the output while STANDBY or on
   * demand). The image is copied under a new random name every time, so a
   * cached copy of the previous KV can never show up; the previous file is
   * removed. Returns the updated event.
   */
  setKv(eventId: string, srcPath: string): EventMeta {
    const ev = this.findEvent(eventId)
    const src = String(srcPath)
    if (src.startsWith('\\\\') || src.startsWith('//')) {
      throw new Error('Choose a KV image from a disk on this computer, not from the network.')
    }
    const ext = path.extname(src).slice(1).toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(KV_MIME, ext)) {
      throw new Error('This KV format is not supported. Choose a PNG, JPG, or WebP image.')
    }
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(src)
    } catch {
      throw new Error('KV file not found. Choose the KV image again.')
    }
    if (stat.isSymbolicLink()) {
      throw new Error('A KV image cannot be a shortcut or link. Choose the image file itself.')
    }
    if (!stat.isFile())
      throw new Error('The selection is not a file. Choose a KV image file (PNG, JPG, or WebP).')
    if (stat.size > KV_MAX_BYTES) {
      throw new Error('The KV file is too large. Use an image of 50 MB or less.')
    }
    const dir = this.kvDir(eventId)
    const file = `${randomUUID()}.${ext}`
    const target = path.join(dir, file)
    const previous = ev.kv
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(src, target)
      if (fs.statSync(target).size > KV_MAX_BYTES) {
        throw new Error('The KV file is too large. Use an image of 50 MB or less.')
      }
      ev.kv = file
      this.saveEvents()
    } catch (err) {
      ev.kv = previous
      if (previous === undefined) delete ev.kv
      fs.rmSync(target, { force: true })
      throw err
    }
    this.removeKvFile(eventId, previous)
    return copyEvent(ev)
  }

  /** Delete a stored KV file, but only if its name is one we generated (never follow a damaged events.json). */
  private removeKvFile(eventId: string, file: string | undefined): void {
    if (file === undefined || !KV_FILE_RE.test(file)) return
    fs.rmSync(path.join(this.kvDir(eventId), file), { force: true })
  }

  /** Remove the event's KV (file and field). No-op without a KV. Returns the updated event. */
  clearKv(eventId: string): EventMeta {
    const ev = this.findEvent(eventId)
    const previous = ev.kv
    if (previous !== undefined) {
      delete ev.kv
      try {
        this.saveEvents()
      } catch (err) {
        ev.kv = previous
        throw err
      }
      this.removeKvFile(eventId, previous)
    }
    return copyEvent(ev)
  }

  /** Path of the event's KV image; only the stored file name resolves (no traversal). */
  kvFilePath(eventId: string, file: string): string {
    const ev = this.findEvent(eventId)
    if (typeof file !== 'string' || !ev.kv || file !== ev.kv || !KV_FILE_RE.test(file)) {
      throw new Error('KV not found. Choose a KV image for this event.')
    }
    return path.join(this.kvDir(eventId), file)
  }

  getDeck(deckId: string): DeckMeta {
    return this.readDeck(deckId)
  }

  /**
   * Path of a slide image by its file name. Files never change for a slide
   * (a reorder only changes their order in deck.json), so a URL built from the
   * file always shows the same image.
   */
  slideFilePath(deckId: string, file: string): string {
    const deck = this.readDeck(deckId)
    if (!deck.slides.some((s) => s.file === file)) {
      throw new Error('Slide not found. Choose a slide that exists in this deck.')
    }
    return path.join(this.deckDir(deckId), file)
  }

  /** Path of a slide's video by file name; only a video some slide of the deck lists resolves. */
  videoFilePath(deckId: string, file: string): string {
    const deck = this.readDeck(deckId)
    if (!deck.slides.some((s) => s.video === file)) {
      throw new Error('Video not found. Choose a slide that exists in this deck.')
    }
    return path.join(this.deckDir(deckId), file)
  }

  /** Generates all thumbnails of a new deck in the background, yielding between slides. */
  private async generateThumbs(deck: DeckMeta): Promise<void> {
    for (const s of deck.slides) {
      await new Promise<void>((r) => setImmediate(r))
      await this.ensureThumb(deck.id, s.file)
    }
  }

  /** Thumbnail path for a slide file (may not exist yet). */
  private thumbPath(deckId: string, file: string): string {
    return path.join(this.deckDir(deckId), 'thumbs', thumbFileName(file))
  }

  /**
   * Path of the slide's thumbnail, created on first request and cached on disk
   * (existing decks get theirs lazily). Falls back to the full-size slide when
   * generation fails, so the strip always has an image.
   */
  async thumbFilePath(deckId: string, file: string): Promise<string> {
    const full = this.slideFilePath(deckId, file)
    return (await this.ensureThumb(deckId, file)) ? this.thumbPath(deckId, file) : full
  }

  private ensureThumb(deckId: string, file: string): Promise<boolean> {
    const dest = this.thumbPath(deckId, file)
    if (fs.existsSync(dest)) return Promise.resolve(true)
    let job = this.thumbJobs.get(dest)
    if (!job) {
      job = (async () => {
        const src = path.join(this.deckDir(deckId), file)
        try {
          // Never recreate a deck folder that was removed in the meantime.
          if (!fs.existsSync(src)) return false
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          this.makeThumb(src, dest)
          return true
        } catch {
          return false
        }
      })()
      const mine = job
      this.thumbJobs.set(dest, mine)
      // Only forget this job: a newer one for the same file (snapshot replaced) stays.
      void mine.then(() => {
        if (this.thumbJobs.get(dest) === mine) this.thumbJobs.delete(dest)
      })
    }
    return job
  }

  slidePath(deckId: string, index: number): string {
    const deck = this.readDeck(deckId)
    const slide = deck.slides[index]
    if (!slide) throw new Error('Slide not found. Choose a slide number that exists in this deck.')
    return path.join(this.deckDir(deckId), slide.file)
  }
}
