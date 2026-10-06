export interface SlideMeta {
  file: string
  notes: string
}

export interface DeckMeta {
  id: string
  name: string
  source: 'pptx' | 'pdf'
  width: number
  height: number
  slides: SlideMeta[]
}

export interface EventMeta {
  id: string
  name: string
  deckIds: string[]
}
