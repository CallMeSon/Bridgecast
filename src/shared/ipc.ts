import type { DeckMeta, EventMeta } from './types'
import type { Action, ProgramState } from './program'
import type { HdmiSettings, NdiSettings, Settings } from './settings'
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
  programDispatch: 'program:dispatch',
  programGet: 'program:get',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  ndiGetStatus: 'ndi:getStatus',
  displaysList: 'displays:list',
  hdmiSet: 'hdmi:set',
  hdmiGetStatus: 'hdmi:getStatus'
} as const

/**
 * Renderer → main one-way messages (ipcRenderer.send). Main only accepts them
 * from the webContents they concern (see Output), so another window cannot
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
  ndiStatus: 'ndi:status',
  displaysChanged: 'displays:changed',
  hdmiStatus: 'hdmi:status'
} as const

export interface ImportProgress {
  id: string
  name: string
  percent: number
  status: 'busy' | 'done' | 'error'
  message?: string
}

/** PDF pages rendered in the renderer (pdf.js) and handed to main to store. */
/**
 * NDI sender state. `running` only once the NDI source actually exists;
 * `message` (Indonesian, with the fix) on `error`; `source` is the full name
 * receivers show, e.g. "STUDIO-PC (PPT Share)".
 */
export interface NdiStatus {
  state: 'running' | 'stopped' | 'error'
  message?: string
  source?: string
}

/**
 * HDMI output window state: `showing` (fullscreen on its display), `hidden`
 * (its display is not connected, or it is still being prepared: `message`),
 * `off`, or `error` with an Indonesian `message` that says how to fix it.
 */
export interface HdmiStatus {
  state: 'showing' | 'hidden' | 'off' | 'error'
  message?: string
}

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
  'decks:reorder': { args: [eventId: string, deckIds: string[]]; result: void }
  'slides:reorder': { args: [deckId: string, order: number[]]; result: void }
  'decks:remove': { args: [eventId: string, deckId: string]; result: void }
  'program:dispatch': { args: [action: Action]; result: ProgramState }
  'program:get': { args: []; result: Session }
  'settings:get': { args: []; result: Settings }
  /** NDI only; the saved HDMI settings are kept (they change through hdmi:set). */
  'settings:set': { args: [settings: { ndi: NdiSettings }]; result: Settings }
  'ndi:getStatus': { args: []; result: NdiStatus }
  'displays:list': { args: []; result: DisplayInfo[] }
  /** Validated in main against the connected displays; saves and applies at once. */
  'hdmi:set': { args: [hdmi: HdmiSettings]; result: Settings }
  'hdmi:getStatus': { args: []; result: HdmiStatus }
}

export interface BroadcastMap {
  'program:state': ProgramState
  'import:progress': ImportProgress
  'ndi:status': NdiStatus
  'displays:changed': DisplayInfo[]
  'hdmi:status': HdmiStatus
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

export interface Api {
  listEvents(): Promise<EventMeta[]>
  createEvent(name: string): Promise<EventMeta>
  selectEvent(eventId: string): Promise<ProgramState>
  listDecks(eventId: string): Promise<DeckMeta[]>
  importDecks(eventId: string, files: ImportRequest[]): Promise<void>
  addRendered(eventId: string, payload: RenderedDeck): Promise<DeckMeta>
  reorderDecks(eventId: string, deckIds: string[]): Promise<void>
  reorderSlides(deckId: string, order: number[]): Promise<void>
  removeDeck(eventId: string, deckId: string): Promise<void>
  dispatch(action: Action): Promise<ProgramState>
  getSession(): Promise<Session>
  onProgramState(cb: (s: ProgramState) => void): () => void
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  getSettings(): Promise<Settings>
  /** Validates, saves and applies (restarts output + sender when needed). */
  setSettings(s: { ndi: NdiSettings }): Promise<Settings>
  getNdiStatus(): Promise<NdiStatus>
  onNdiStatus(cb: (s: NdiStatus) => void): () => void
  listDisplays(): Promise<DisplayInfo[]>
  onDisplaysChanged(cb: (d: DisplayInfo[]) => void): () => void
  /** Turns HDMI output on/off or moves it to another display (applied at once). */
  setHdmi(h: HdmiSettings): Promise<Settings>
  getHdmiStatus(): Promise<HdmiStatus>
  onHdmiStatus(cb: (s: HdmiStatus) => void): () => void
  /** Output windows only (NDI, HDMI): the first frame for the current program state is rendered. */
  outputReady(): void
  pathForFile(file: File): string
}
