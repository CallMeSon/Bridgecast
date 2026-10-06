import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import type { DeckMeta, EventMeta } from '../shared/types'

type DeckInput = {
  name: string
  source: 'pptx' | 'pdf'
  width: number
  height: number
  slides: { pngPath: string; notes: string }[]
}

const slideName = (i: number): string => `${String(i + 1).padStart(3, '0')}.png`

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

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
    return path.join(this.root, 'decks', deckId)
  }

  private loadEvents(): EventMeta[] {
    if (!fs.existsSync(this.eventsFile)) return []
    return JSON.parse(fs.readFileSync(this.eventsFile, 'utf8')) as EventMeta[]
  }

  private saveEvents(): void {
    writeJsonAtomic(this.eventsFile, this.events)
  }

  private findEvent(eventId: string): EventMeta {
    const ev = this.events.find((e) => e.id === eventId)
    if (!ev) throw new Error(`Event tidak ditemukan: ${eventId}`)
    return ev
  }

  private readDeck(deckId: string): DeckMeta {
    const file = path.join(this.deckDir(deckId), 'deck.json')
    if (!fs.existsSync(file)) throw new Error(`Deck tidak ditemukan: ${deckId}`)
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
    const dir = this.deckDir(deckId)
    const tmpName = (i: number): string => `.tmp-${slideName(i)}`
    // Two-phase rename so no file is overwritten mid-way.
    deck.slides.forEach((s, i) => fs.renameSync(path.join(dir, s.file), path.join(dir, tmpName(i))))
    const slides = order.map((from, to) => {
      const file = slideName(to)
      fs.renameSync(path.join(dir, tmpName(from)), path.join(dir, file))
      return { file, notes: deck.slides[from].notes }
    })
    this.writeDeck({ ...deck, slides })
  }

  removeDeck(eventId: string, deckId: string): void {
    const ev = this.findEvent(eventId)
    ev.deckIds = ev.deckIds.filter((id) => id !== deckId)
    this.saveEvents()
    fs.rmSync(this.deckDir(deckId), { recursive: true, force: true })
  }

  slidePath(deckId: string, index: number): string {
    const deck = this.readDeck(deckId)
    const slide = deck.slides[index]
    if (!slide) throw new Error(`Slide tidak ditemukan: ${index}`)
    return path.join(this.deckDir(deckId), slide.file)
  }
}
