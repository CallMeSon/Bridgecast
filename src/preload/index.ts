import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  Broadcast,
  Invoke,
  Send,
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
  reorderDecks: (eventId, items) => invoke(Invoke.decksReorder, eventId, items),
  addSection: (eventId, at) => invoke(Invoke.sectionsAdd, eventId, at),
  renameSection: (eventId, sectionId, name) =>
    invoke(Invoke.sectionsRename, eventId, sectionId, name),
  removeSection: (eventId, sectionId) => invoke(Invoke.sectionsRemove, eventId, sectionId),
  reorderSlides: (deckId, order) => invoke(Invoke.slidesReorder, deckId, order),
  removeDeck: (eventId, deckId) => invoke(Invoke.decksRemove, eventId, deckId),
  renameDeck: (eventId, deckId, name) => invoke(Invoke.decksRename, eventId, deckId, name),
  setDeckFit: (eventId, deckId, fit) => invoke(Invoke.decksSetFit, eventId, deckId, fit),
  setDeckAudio: (eventId, deckId, audio) => invoke(Invoke.decksSetAudio, eventId, deckId, audio),
  setEventCanvas: (eventId, canvas) => invoke(Invoke.eventsSetCanvas, eventId, canvas),
  setDefaultCanvas: (canvas) => invoke(Invoke.canvasSetDefault, canvas),
  setKv: (eventId, path) => invoke(Invoke.kvSet, eventId, path),
  clearKv: (eventId) => invoke(Invoke.kvClear, eventId),
  dispatch: (action) => invoke(Invoke.programDispatch, action),
  getSession: () => invoke(Invoke.programGet),
  onProgramState: (cb) => subscribe(Broadcast.programState, cb),
  onImportProgress: (cb) => subscribe(Broadcast.importProgress, cb),
  getSettings: () => invoke(Invoke.settingsGet),
  listDisplays: () => invoke(Invoke.displaysList),
  onDisplaysChanged: (cb) => subscribe(Broadcast.displaysChanged, cb),
  setHdmi: (h) => invoke(Invoke.hdmiSet, h),
  getHdmiStatus: () => invoke(Invoke.hdmiGetStatus),
  onHdmiStatus: (cb) => subscribe(Broadcast.hdmiStatus, cb),
  setAudio: (a) => invoke(Invoke.audioSet, a),
  onAudioSettings: (cb) => subscribe(Broadcast.audioSettings, cb),
  outputReady: () => ipcRenderer.send(Send.outputReady),
  // File.path no longer exists in Electron; this is the supported replacement.
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
