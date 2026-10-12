import type { DeckMeta, EventMeta } from './types'
import type { OrderItem } from './sections'
import type { Action, ProgramState } from './program'
import type { AudioSettings, HdmiSettings, Settings } from './settings'
import type { DisplayInfo } from './displays'

/** Request/response channels (ipcRenderer.invoke ↔ ipcMain.handle). */
export const Invoke = {
  eventsList: 'events:list',
  eventsCreate: 'events:create',
  eventsSelect: 'events:select',
  decksList: 'decks:list',
  decksImport: 'decks:import',
  decksAddRendered: 'decks:addRendered',
  decksReorder: 'decks:reorder',
  slidesReorder: 'slides:reorder',
  decksRemove: 'decks:remove',
  decksRename: 'decks:rename',
  sectionsAdd: 'sections:add',
  sectionsRename: 'sections:rename',
  sectionsRemove: 'sections:remove',
  kvSet: 'kv:set',
  kvClear: 'kv:clear',
  programDispatch: 'program:dispatch',
  programGet: 'program:get',
  settingsGet: 'settings:get',
  displaysList: 'displays:list',
  hdmiSet: 'hdmi:set',
  hdmiGetStatus: 'hdmi:getStatus',
  audioSet: 'audio:set'
} as const

/**
 * Renderer → main one-way messages (ipcRenderer.send). Main only accepts them
 * from the webContents they concern (see HdmiOutput), so another window cannot
 * spoof them.
 */
export const Send = {
  /**
   * Sent once by an output window (`#/output`) when its first layer for the
   * current program state (a slide, or black) is decoded, committed and painted.
   */
  outputReady: 'output:ready'
} as const

/** Main → renderer broadcasts (webContents.send ↔ ipcRenderer.on). */
export const Broadcast = {
  programState: 'program:state',
  importProgress: 'import:progress',
  displaysChanged: 'displays:changed',
  hdmiStatus: 'hdmi:status',
  audioSettings: 'audio:settings'
} as const

export interface ImportProgress {
  id: string
  name: string
  percent: number
  status: 'busy' | 'done' | 'error'
  message?: string
}

/**
 * HDMI output window state: `showing` (fullscreen on its display), `hidden`
 * (its display is not connected, or it is still being prepared: `message`),
 * `off`, or `error` with a user-facing `message` that says how to fix it.
 */
export interface HdmiStatus {
  state: 'showing' | 'hidden' | 'off' | 'error'
  message?: string
}

/** PDF pages rendered in the renderer (pdf.js) and handed to main to store. */
export interface RenderedDeck {
  name: string
  width: number
  height: number
  pages: Uint8Array[]
  notes?: string[]
}

export interface ImportRequest {
  id: string
  path: string
}

export interface Session {
  eventId: string | null
  state: ProgramState
}

/** Argument tuple and result for every invoke channel. */
export interface InvokeMap {
  'events:list': { args: []; result: EventMeta[] }
  'events:create': { args: [name: string]; result: EventMeta }
  'events:select': { args: [eventId: string]; result: ProgramState }
  'decks:list': { args: [eventId: string]; result: DeckMeta[] }
  'decks:import': { args: [eventId: string, files: ImportRequest[]]; result: void }
  'decks:addRendered': { args: [eventId: string, payload: RenderedDeck]; result: DeckMeta }
  'decks:reorder': { args: [eventId: string, items: OrderItem[]]; result: void }
  'slides:reorder': { args: [deckId: string, order: number[]]; result: void }
  'decks:remove': { args: [eventId: string, deckId: string]; result: void }
  'decks:rename': { args: [eventId: string, deckId: string, name: string]; result: DeckMeta }
  'sections:add': {
    args: [eventId: string, at: number | 'end']
    result: { event: EventMeta; sectionId: string }
  }
  'sections:rename': { args: [eventId: string, sectionId: string, name: string]; result: EventMeta }
  'sections:remove': { args: [eventId: string, sectionId: string]; result: EventMeta }
  /** Absolute path of an image (PNG, JPG, WebP, at most 50 MB); returns the updated event. */
  'kv:set': { args: [eventId: string, path: string]; result: EventMeta }
  'kv:clear': { args: [eventId: string]; result: EventMeta }
  'program:dispatch': { args: [action: Action]; result: ProgramState }
  'program:get': { args: []; result: Session }
  'settings:get': { args: []; result: Settings }
  'displays:list': { args: []; result: DisplayInfo[] }
  /** Validated in main against the connected displays; saves and applies at once. */
  'hdmi:set': { args: [hdmi: HdmiSettings]; result: Settings }
  'hdmi:getStatus': { args: []; result: HdmiStatus }
  /** Sanitized, saved, then broadcast as `audio:settings`; applies at once to the output. */
  'audio:set': { args: [audio: AudioSettings]; result: Settings }
}

export interface BroadcastMap {
  'program:state': ProgramState
  'import:progress': ImportProgress
  'displays:changed': DisplayInfo[]
  'hdmi:status': HdmiStatus
  'audio:settings': AudioSettings
}

export type InvokeChannel = keyof InvokeMap

/**
 * `slide://<deckId>/<file>`, e.g. `slide://<uuid>/003.png`. Built from the
 * slide's file (SlideMeta.file / ShownSlide.file), never its index: the same
 * URL is always the same image, so a reorder can never show a stale image.
 */
export function slideUrl(deckId: string, file: string): string {
  return `slide://${deckId}/${file}`
}

/**
 * `slide://<deckId>/thumbs/<n>.jpg`: small (320 px) thumbnail of slide file
 * `<n>.png`, for the strip. Follows the slide's file, so a reorder keeps the
 * right thumbnail.
 */
export function thumbUrl(deckId: string, file: string): string {
  return `slide://${deckId}/thumbs/${file.replace(/\.png$/i, '.jpg')}`
}

/**
 * `slide://kv/<eventId>/<file>`: the event's KV image (file = EventMeta.kv, a
 * new name for every upload, so a URL never shows an older image).
 */
export function kvImageUrl(eventId: string, file: string): string {
  return `slide://kv/${eventId}/${file}`
}

export interface Api {
  listEvents(): Promise<EventMeta[]>
  createEvent(name: string): Promise<EventMeta>
  selectEvent(eventId: string): Promise<ProgramState>
  listDecks(eventId: string): Promise<DeckMeta[]>
  importDecks(eventId: string, files: ImportRequest[]): Promise<void>
  addRendered(eventId: string, payload: RenderedDeck): Promise<DeckMeta>
  reorderDecks(eventId: string, items: OrderItem[]): Promise<void>
  addSection(eventId: string, at: number | 'end'): Promise<{ event: EventMeta; sectionId: string }>
  renameSection(eventId: string, sectionId: string, name: string): Promise<EventMeta>
  removeSection(eventId: string, sectionId: string): Promise<EventMeta>
  reorderSlides(deckId: string, order: number[]): Promise<void>
  removeDeck(eventId: string, deckId: string): Promise<void>
  /** Display name only; validated in main (not empty, at most 120 characters). */
  renameDeck(eventId: string, deckId: string, name: string): Promise<DeckMeta>
  /** Set the event's KV image from an absolute path (`pathForFile`); validated in main. */
  setKv(eventId: string, path: string): Promise<EventMeta>
  clearKv(eventId: string): Promise<EventMeta>
  dispatch(action: Action): Promise<ProgramState>
  getSession(): Promise<Session>
  onProgramState(cb: (s: ProgramState) => void): () => void
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  getSettings(): Promise<Settings>
  listDisplays(): Promise<DisplayInfo[]>
  onDisplaysChanged(cb: (d: DisplayInfo[]) => void): () => void
  /** Turns HDMI output on/off or moves it to another display (applied at once). */
  setHdmi(h: HdmiSettings): Promise<Settings>
  getHdmiStatus(): Promise<HdmiStatus>
  onHdmiStatus(cb: (s: HdmiStatus) => void): () => void
  /** Sound device and mute for video slides on the HDMI output (applied at once). */
  setAudio(a: AudioSettings): Promise<Settings>
  onAudioSettings(cb: (a: AudioSettings) => void): () => void
  /** Output window only (HDMI): the first frame for the current program state is rendered. */
  outputReady(): void
  pathForFile(file: File): string
}
