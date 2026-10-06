import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  Broadcast,
  Invoke,
  type Api,
  type BroadcastMap,
  type InvokeChannel,
  type InvokeMap
} from '../shared/ipc'

function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeMap[C]['args']
): Promise<InvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

function subscribe<C extends keyof BroadcastMap>(
  channel: C,
  cb: (payload: BroadcastMap[C]) => void
): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: BroadcastMap[C]): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  listEvents: () => invoke(Invoke.eventsList),
  createEvent: (name) => invoke(Invoke.eventsCreate, name),
  selectEvent: (eventId) => invoke(Invoke.eventsSelect, eventId),
  listDecks: (eventId) => invoke(Invoke.decksList, eventId),
  importDecks: (eventId, files) => invoke(Invoke.decksImport, eventId, files),
  addRendered: (eventId, payload) => invoke(Invoke.decksAddRendered, eventId, payload),
  reorderDecks: (eventId, deckIds) => invoke(Invoke.decksReorder, eventId, deckIds),
  reorderSlides: (deckId, order) => invoke(Invoke.slidesReorder, deckId, order),
  removeDeck: (eventId, deckId) => invoke(Invoke.decksRemove, eventId, deckId),
  dispatch: (action) => invoke(Invoke.programDispatch, action),
  getSession: () => invoke(Invoke.programGet),
  onProgramState: (cb) => subscribe(Broadcast.programState, cb),
  onImportProgress: (cb) => subscribe(Broadcast.importProgress, cb),
  getSettings: () => invoke(Invoke.settingsGet),
  setSettings: (s) => invoke(Invoke.settingsSet, s),
  getNdiStatus: () => invoke(Invoke.ndiGetStatus),
  onNdiStatus: (cb) => subscribe(Broadcast.ndiStatus, cb),
  // File.path no longer exists in Electron; this is the supported replacement.
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
