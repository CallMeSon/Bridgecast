import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import {
  DECK_NAME_MAX,
  KV_FILE_RE,
  KV_MAX_BYTES,
  KV_MIME,
  type DeckMeta,
  type EventMeta
} from '../shared/types'

type DeckInput = {
  name: string
  source: 'pptx' | 'pdf'
  width: number
  height: number
  slides: { pngPath: string; notes: string }[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const slideName = (i: number): string => `${String(i + 1).padStart(3, '0')}.png`

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export { DECK_NAME_MAX }

export class Library {
  private events: EventMeta[]

  constructor(private root: string) {
    fs.mkdirSync(path.join(root, 'decks'), { recursive: true })
    this.events = this.loadEvents()
  }

  private get eventsFile(): string {
    return path.join(this.root, 'events.json')
  }

  private deckDir(deckId: string): string {
    if (!UUID_RE.test(deckId)) {
      throw new Error('Id deck tidak valid. Muat ulang daftar deck lalu pilih deck dari daftar.')
    }
    return path.join(this.root, 'decks', deckId)
  }

  private loadEvents(): EventMeta[] {
    if (!fs.existsSync(this.eventsFile)) return []
    try {
      return JSON.parse(fs.readFileSync(this.eventsFile, 'utf8')) as EventMeta[]
    } catch {
      throw new Error(
        'File events.json rusak dan tidak bisa dibaca. Pulihkan dari cadangan atau hapus file tersebut untuk memulai dari awal.'
      )
    }
  }

  private saveEvents(): void {
    writeJsonAtomic(this.eventsFile, this.events)
  }

  private findEvent(eventId: string): EventMeta {
    const ev = this.events.find((e) => e.id === eventId)
    if (!ev)
      throw new Error('Event tidak ditemukan. Pilih event lain dari menu atau buat event baru.')
    return ev
  }

  private readDeck(deckId: string): DeckMeta {
    const file = path.join(this.deckDir(deckId), 'deck.json')
    if (!fs.existsSync(file))
      throw new Error('Deck tidak ditemukan. Muat ulang daftar deck atau impor deck kembali.')
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DeckMeta
  }

  private writeDeck(deck: DeckMeta): void {
    writeJsonAtomic(path.join(this.deckDir(deck.id), 'deck.json'), deck)
  }

  createEvent(name: string): EventMeta {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Nama event kosong')
    const ev: EventMeta = { id: randomUUID(), name: trimmed, deckIds: [] }
    this.events.push(ev)
    this.saveEvents()
    return { ...ev, deckIds: [...ev.deckIds] }
  }

  listEvents(): EventMeta[] {
    return this.events.map((e) => ({ ...e, deckIds: [...e.deckIds] }))
  }

  getDecks(eventId: string): DeckMeta[] {
    return this.findEvent(eventId).deckIds.map((id) => this.readDeck(id))
  }

  addDeck(eventId: string, d: DeckInput): DeckMeta {
    const ev = this.findEvent(eventId)
    const id = randomUUID()
    const dir = this.deckDir(id)
    fs.mkdirSync(dir, { recursive: true })
    try {
      const slides = d.slides.map((s, i) => {
        const file = slideName(i)
        fs.copyFileSync(s.pngPath, path.join(dir, file))
        return { file, notes: s.notes }
      })
      const deck: DeckMeta = {
        id,
        name: d.name,
        source: d.source,
        width: d.width,
        height: d.height,
        slides
      }
      this.writeDeck(deck)
      ev.deckIds.push(id)
      this.saveEvents()
      return deck
    } catch (err) {
      ev.deckIds = ev.deckIds.filter((x) => x !== id)
      fs.rmSync(dir, { recursive: true, force: true })
      throw err
    }
  }

  reorderDecks(eventId: string, deckIds: string[]): void {
    const ev = this.findEvent(eventId)
    const valid =
      deckIds.length === ev.deckIds.length &&
      new Set(deckIds).size === deckIds.length &&
      deckIds.every((id) => ev.deckIds.includes(id))
    if (!valid) {
      throw new Error('Daftar deck tidak valid: harus memuat semua deck event tepat satu kali')
    }
    ev.deckIds = [...deckIds]
    this.saveEvents()
  }

  reorderSlides(deckId: string, order: number[]): void {
    const deck = this.readDeck(deckId)
    const n = deck.slides.length
    const valid =
      order.length === n &&
      new Set(order).size === n &&
      order.every((i) => Number.isInteger(i) && i >= 0 && i < n)
    if (!valid) {
      throw new Error('Urutan slide tidak valid: harus permutasi dari semua indeks slide')
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
        'Deck tidak ditemukan di event ini. Muat ulang daftar deck lalu pilih deck dari daftar.'
      )
    }
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) throw new Error('Nama deck kosong. Isi nama, misalnya "Sesi 1 - Pembukaan".')
    if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) {
      throw new Error('Nama deck berisi karakter yang tidak didukung. Ketik ulang namanya.')
    }
    if ([...trimmed].length > DECK_NAME_MAX) {
      throw new Error(`Nama deck terlalu panjang. Pakai paling banyak ${DECK_NAME_MAX} karakter.`)
    }
    const deck = { ...this.readDeck(deckId), name: trimmed }
    this.writeDeck(deck)
    return deck
  }

  removeDeck(eventId: string, deckId: string): void {
    const ev = this.findEvent(eventId)
    if (!ev.deckIds.includes(deckId)) {
      throw new Error(
        'Deck tidak ditemukan di event ini. Muat ulang daftar deck lalu pilih deck dari daftar.'
      )
    }
    ev.deckIds = ev.deckIds.filter((id) => id !== deckId)
    this.saveEvents()
    fs.rmSync(this.deckDir(deckId), { recursive: true, force: true })
  }

  private kvDir(eventId: string): string {
    // Event ids are uuids we generated; refuse anything else before using it as a folder name.
    if (!UUID_RE.test(eventId)) {
      throw new Error('Id event tidak valid. Muat ulang aplikasi lalu pilih event dari menu.')
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
    const ext = path.extname(String(srcPath)).slice(1).toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(KV_MIME, ext)) {
      throw new Error('Format KV tidak didukung. Pilih gambar PNG, JPG, atau WebP.')
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(srcPath)
    } catch {
      throw new Error('File KV tidak ditemukan. Pilih gambar KV lagi.')
    }
    if (!stat.isFile())
      throw new Error('Yang dipilih bukan file. Pilih file gambar KV (PNG, JPG, atau WebP).')
    if (stat.size > KV_MAX_BYTES) {
      throw new Error('File KV terlalu besar. Pakai gambar yang ukurannya paling banyak 50 MB.')
    }
    const dir = this.kvDir(eventId)
    const file = `${randomUUID()}.${ext}`
    const previous = ev.kv
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(srcPath, path.join(dir, file))
    ev.kv = file
    try {
      this.saveEvents()
    } catch (err) {
      ev.kv = previous
      if (previous === undefined) delete ev.kv
      fs.rmSync(path.join(dir, file), { force: true })
      throw err
    }
    if (previous) fs.rmSync(path.join(dir, previous), { force: true })
    return { ...ev, deckIds: [...ev.deckIds] }
  }

  /** Remove the event's KV (file and field). No-op without a KV. Returns the updated event. */
  clearKv(eventId: string): EventMeta {
    const ev = this.findEvent(eventId)
    const previous = ev.kv
    if (previous !== undefined) {
      delete ev.kv
      this.saveEvents()
      fs.rmSync(path.join(this.kvDir(eventId), previous), { force: true })
    }
    return { ...ev, deckIds: [...ev.deckIds] }
  }

  /** Path of the event's KV image; only the stored file name resolves (no traversal). */
  kvFilePath(eventId: string, file: string): string {
    const ev = this.findEvent(eventId)
    if (typeof file !== 'string' || !ev.kv || file !== ev.kv || !KV_FILE_RE.test(file)) {
      throw new Error('KV tidak ditemukan. Pilih gambar KV untuk event ini.')
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
      throw new Error('Slide tidak ditemukan. Pilih slide yang ada di deck ini.')
    }
    return path.join(this.deckDir(deckId), file)
  }

  slidePath(deckId: string, index: number): string {
    const deck = this.readDeck(deckId)
    const slide = deck.slides[index]
    if (!slide) throw new Error('Slide tidak ditemukan. Pilih nomor slide yang ada di deck ini.')
    return path.join(this.deckDir(deckId), slide.file)
  }
}
