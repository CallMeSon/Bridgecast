// Windows only: drives the real PowerPoint engine (no PPT_ENGINE_FAKE). Imports fixtures/sample-anim.pptx,
// takes it on a simulated second display, walks the click steps and reports what the output shows.
// Run: node e2e/native-real.mjs   (after npm run build; OUT=<dir> for screenshots)
import { _electron as electron } from 'playwright'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'real-'))
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-real-ud-'))
const log = (...a) => console.log(...a)

// Never touch a PowerPoint that is not ours: the test only runs (and only kills PowerPoint) when none runs at start.
const pptRunning = () => execSync('tasklist /FI "IMAGENAME eq POWERPNT.EXE" /NH').toString().includes('POWERPNT.EXE')
if (pptRunning()) {
  console.log('A PowerPoint is already running. Close it first; this test would otherwise share (and kill) it.')
  process.exit(2)
}
const app = await electron.launch({
  args: [root], cwd: root,
  env: { ...process.env, PPT_SHARE_USER_DATA: userData, PPT_OUTPUT_DUMP: fs.mkdtempSync(path.join(os.tmpdir(), 'dump-')), ELECTRON_RENDERER_URL: '' }
})
app.process().stdout?.on('data', (d) => log('MAIN', String(d).trim().slice(0, 300)))
app.process().stderr?.on('data', (d) => log('MAINERR', String(d).trim().slice(0, 300)))
const win = await app.firstWindow()
win.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log('CONSOLE', m.text().slice(0, 300)) })
win.on('pageerror', (e) => log('PAGEERROR', String(e)))
await win.waitForSelector('.app')
const api = (fn, arg) => win.evaluate(fn, arg)
const state = async () => (await api(() => window.api.getSession())).state
const dispatch = async (a) => { await api((x) => window.api.dispatch(x), a); return state() }
const status = () => api(() => window.api.slideshowStatus())
async function until(fn, pred, what, t = 30000) {
  const end = Date.now() + t; let v
  while (Date.now() < end) { v = await fn(); if (pred(v)) return v; await sleep(150) }
  throw new Error(`TIMEOUT ${what}: ${JSON.stringify(v)}`)
}
const hdmiRaw = async () => app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.getTitle() === 'PPT Share HDMI')
  if (!w) return null
  const img = await w.webContents.capturePage()
  const { width, height } = img.getSize()
  const bmp = img.toBitmap()
  let sum = 0, n = 0
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) { const i = (y * width + x) * 4; sum += bmp[i] + bmp[i + 1] + bmp[i + 2]; n++ }
  const dom = await w.webContents.executeJavaScript(`[...document.querySelectorAll('[data-state]')].map((l)=>({state:l.dataset.state,kind:l.dataset.kind||null,video:(()=>{const v=l.querySelector('video');return v?{w:v.videoWidth,h:v.videoHeight,paused:v.paused}:null})(),poster:!!l.querySelector('img')}))`)
  return { png: img.toPNG().toString('base64'), size: [width, height], mean: Math.round(sum / n / 3), layers: dom }
}, null)
const hdmi = async (name) => { const r = await hdmiRaw(); if (!r) return null; fs.writeFileSync(name, Buffer.from(r.png, 'base64')); delete r.png; return r }

try {
  const ev = await api(() => window.api.createEvent('Real PPT'))
  const eventId = ev.id ?? ev
  await api((e) => window.api.selectEvent?.(e), eventId).catch(() => undefined)
  const id = crypto.randomUUID()
  await api(() => window.api.onImportProgress((p) => console.error('PROGRESS ' + JSON.stringify(p))))
  await api(([e, i, p]) => window.api.importDecks(e, [{ id: i, path: p }]), [eventId, id, path.join(root, 'fixtures', 'sample-anim.pptx')])
  const deck = await until(async () => {
    try { const ev = JSON.parse(fs.readFileSync(path.join(userData, 'events.json'), 'utf8')).find((x) => x.id === eventId); return (ev?.deckIds ?? []).map((d) => JSON.parse(fs.readFileSync(path.join(userData, 'decks', d, 'deck.json'), 'utf8'))) } catch { return [] }
  }, (d) => d.length > 0, 'deck imported', 240000)
  const deckId = deck[0].id
  log('imported', deckId, 'slides', deck[0].slides?.length, 'playback', deck[0].playback)

  const prim = await app.evaluate(({ screen }) => { const d = screen.getPrimaryDisplay(); return { id: d.id, bounds: d.bounds } })
  const b = prim.bounds
  await app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), [
    { id: prim.id, label: 'Display 1', width: b.width, height: b.height, primary: true, bounds: b },
    { id: 515151, label: 'E2E OUTPUT', width: 1920, height: 1080, primary: false, bounds: { x: b.x + b.width - 960, y: b.y + b.height - 540, width: 960, height: 540 } }
  ])
  await api(() => window.api.setHdmi({ enabled: true, displayId: 515151 }))
  await until(() => api(() => window.api.getHdmiStatus()), (s) => s.state === 'showing', 'HDMI showing', 20000)

  await dispatch({ type: 'selectDeck', deckId })
  let st = await until(status, (s) => ['ready', 'fallback'].includes(s.decks[deckId]), 'engine ready', 120000)
  log('engine status', JSON.stringify(st))
  st = await state(); log('shown', JSON.stringify(st.shown))
  await sleep(3000)
  log('step0', JSON.stringify(await hdmi(path.join(outDir, 'step0.png'))))
  for (let i = 1; i <= 4; i++) {
    st = await dispatch({ type: 'next' }); await sleep(1500)
    log(`next${i}`, JSON.stringify({ idx: st.shown?.index, step: st.shown?.step, pb: st.shown?.playback }), JSON.stringify(await hdmi(path.join(outDir, `next${i}.png`))))
  }
  // kill PowerPoint while live
  try { execSync('taskkill /F /IM POWERPNT.EXE') } catch (e) { log('taskkill', String(e.message).slice(0, 100)) }
  const t0 = Date.now(); let last = ''
  while (Date.now() - t0 < 40000) {
    const [st2, ss] = [await state(), await status()]
    const h = await hdmiRaw()
    const cur = JSON.stringify({ pb: st2.shown?.playback, idx: st2.shown?.index, deck: ss.decks[deckId], layers: h?.layers.map((l) => l.kind + (l.video ? ':' + l.video.w : '') + (l.poster ? '+poster' : '')) })
    if (cur !== last) { log(`t+${Date.now() - t0}ms`, cur); last = cur }
    await sleep(300)
  }
} catch (e) { log('FAIL', e.message) }
finally { await app.close().catch(() => {}); await sleep(1500); if (pptRunning()) { try { execSync('taskkill /F /IM POWERPNT.EXE', { stdio: 'ignore' }) } catch {} }; log('out', outDir) }
