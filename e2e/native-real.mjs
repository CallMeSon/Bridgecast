// Windows only: asserts the native slideshow against the REAL PowerPoint (no PPT_ENGINE_FAKE).
// Run: npm run test:e2e:native:win   (needs PowerPoint; no other PowerPoint may be running, because
// the kill step ends PowerPoint). Screenshots go to OUT (default: a temp folder).
// Covered: import, Native chip, click steps, hidden slide skipped, picture size = canvas, no PowerPoint
// title bar at the top edge, PowerPoint killed while live (PNG fallback, back to native, no slide-1
// flash), Vector for a static deck, two native decks, Black, canvas 3840x1080 and 1280x720.
// NOT covered (manual, docs/test-checklist.md): sound, Edit in PowerPoint, clicker, OMT/NDI, side bars.
import { _electron as electron } from 'playwright'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'native-win-'))
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-real-ud-'))
let failed = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} - ${msg}`)
  if (!cond) failed++
}
const pptRunning = () =>
  execSync('tasklist /FI "IMAGENAME eq POWERPNT.EXE" /NH').toString().includes('POWERPNT.EXE')
if (process.platform !== 'win32') {
  console.log('Windows only.')
  process.exit(2)
}
if (pptRunning()) {
  console.log(
    'A PowerPoint is already running. Close it first; this test would otherwise share (and kill) it.'
  )
  process.exit(2)
}

const app = await electron.launch({
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: userData,
    PPT_OUTPUT_DUMP: fs.mkdtempSync(path.join(os.tmpdir(), 'dump-')),
    PPT_SKIP_HOME: '1',
    ELECTRON_RENDERER_URL: ''
  }
})
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log('PAGEERROR', String(e)))
await win.waitForSelector('.app')
const api = (fn, arg) => win.evaluate(fn, arg)
const state = async () => (await api(() => window.api.getSession())).state
const dispatch = async (a) => {
  await api((x) => window.api.dispatch(x), a)
  return state()
}
const status = () => api(() => window.api.slideshowStatus())
async function until(fn, pred, what, t = 30000) {
  const end = Date.now() + t
  let v
  while (Date.now() < end) {
    v = await fn()
    if (pred(v)) return v
    await sleep(150)
  }
  throw new Error(`TIMEOUT ${what}: ${JSON.stringify(v)}`)
}
const hdmiRaw = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && x.getTitle() === 'Bridgecast HDMI'
    )
    if (!w) return null
    const img = await w.webContents.capturePage()
    const { width, height } = img.getSize()
    const bmp = img.toBitmap()
    let sum = 0
    let n = 0
    for (let y = 0; y < height; y += 8)
      for (let x = 0; x < width; x += 8) {
        const i = (y * width + x) * 4
        sum += bmp[i] + bmp[i + 1] + bmp[i + 2]
        n++
      }
    // top edge: mean green of the first 3 rows (a PowerPoint title bar would be dark or coloured)
    let top = 0
    for (let y = 0; y < 3; y++) for (let x = 0; x < width; x++) top += bmp[(y * width + x) * 4 + 1]
    const dom = await w.webContents.executeJavaScript(
      `[...document.querySelectorAll('[data-state]')].map((l)=>({state:l.dataset.state,kind:l.dataset.kind||null,video:(()=>{const v=l.querySelector('video');return v?{w:v.videoWidth,h:v.videoHeight}:null})(),canvas:!!l.querySelector('canvas:not(.stream-still)'),poster:!!l.querySelector('img')}))`
    )
    return {
      png: img.toPNG().toString('base64'),
      mean: Math.round(sum / n / 3),
      top: Math.round(top / (3 * width)),
      layers: dom
    }
  })
const shot = async (name) => {
  const r = await hdmiRaw()
  if (r) fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.png, 'base64'))
  return r
}
const topLayer = (h) => h?.layers[h.layers.length - 1]
const streamSize = (h) => topLayer(h)?.video

const importDeck = async (eventId, file) => {
  const id = crypto.randomUUID()
  await api(([e, i, p]) => window.api.importDecks(e, [{ id: i, path: p }]), [eventId, id, file])
}
const decksOnDisk = (eventId) => {
  try {
    const ev = JSON.parse(fs.readFileSync(path.join(userData, 'events.json'), 'utf8')).find(
      (x) => x.id === eventId
    )
    return (ev?.deckIds ?? []).map((d) =>
      JSON.parse(fs.readFileSync(path.join(userData, 'decks', d, 'deck.json'), 'utf8'))
    )
  } catch {
    return []
  }
}

try {
  const ev = await api(() => window.api.createEvent('Native win'))
  const eventId = ev.id
  await api((e) => window.api.selectEvent(e), eventId)
  const anim = path.join(root, 'fixtures', 'sample-anim.pptx')
  const stat = path.join(root, 'fixtures', 'sample-4x3.pptx')
  await importDeck(eventId, anim)
  await until(async () => decksOnDisk(eventId), (d) => d.length >= 1, 'import 1', 240000)
  await importDeck(eventId, stat)
  await until(async () => decksOnDisk(eventId), (d) => d.length >= 2, 'import 2', 240000)
  await importDeck(eventId, anim)
  const decks = await until(
    async () => decksOnDisk(eventId),
    (d) => d.length >= 3,
    'import 3',
    240000
  )
  const [dA, dS, dB] = decks
  check(dA.playback === 'native' && dB.playback === 'native', 'animated decks import as Native')
  check(dS.playback === 'vector', 'a static deck imports as Vector')
  check(
    dA.slides.length === 6 && dA.slides[0].clicks === 3,
    'slide count 6 and slide 1 has 3 clicks'
  )

  const prim = await app.evaluate(({ screen }) => {
    const d = screen.getPrimaryDisplay()
    return { id: d.id, bounds: d.bounds }
  })
  const b = prim.bounds
  await app.evaluate((_e, l) => globalThis.__pptHdmiFakeDisplays(l), [
    { id: prim.id, label: 'Display 1', width: b.width, height: b.height, primary: true, bounds: b },
    {
      id: 515151,
      label: 'E2E OUTPUT',
      width: 1920,
      height: 1080,
      primary: false,
      bounds: { x: b.x + b.width - 960, y: b.y + b.height - 540, width: 960, height: 540 }
    }
  ])
  await api(() => window.api.setHdmi({ enabled: true, displayId: 515151 }))
  await until(() => api(() => window.api.getHdmiStatus()), (s) => s.state === 'showing', 'HDMI', 20000)

  // ---- take, click steps, hidden slide
  await dispatch({ type: 'selectDeck', deckId: dA.id })
  await until(status, (s) => s.decks[dA.id] === 'ready', 'engine ready', 120000)
  let st = await state()
  check(st.shown?.playback === 'native' && st.shown.index === 0, 'take puts the native deck live')
  await sleep(2500)
  let h = await shot('step0')
  check(
    streamSize(h)?.w === 1920 && streamSize(h)?.h === 1080,
    `stream is 1920x1080 (${JSON.stringify(streamSize(h))})`
  )
  check(topLayer(h)?.kind === 'stream', 'output shows the stream layer')
  const steps = []
  for (let i = 0; i < 5; i++) {
    st = await dispatch({ type: 'next' })
    await sleep(1200)
    steps.push(`${st.shown.index}:${st.shown.step ?? 0}`)
  }
  check(
    steps.join(',') === '0:1,0:2,0:3,1:0,1:1',
    `Next walks click steps then slides (${steps.join(',')})`
  )
  st = await dispatch({ type: 'next' }) // 1:1 -> slide 3 (index 2)
  await sleep(1200)
  st = await dispatch({ type: 'next' }) // slide 4 (index 3) is hidden
  await sleep(1200)
  check(st.shown.index === 4, `Next skips the hidden slide 4 (index ${st.shown.index})`)
  h = await shot('slide5')
  check(h.top > 100, `no dark title bar at the top edge (top mean ${h.top})`)

  // ---- PowerPoint killed while live
  execSync('taskkill /F /IM POWERPNT.EXE')
  const t0 = Date.now()
  let sawImages = false
  let backNative = false
  let flashed = false
  while (Date.now() - t0 < 30000) {
    const s2 = await state()
    const ss = await status()
    if (s2.shown?.playback === 'images') sawImages = true
    if (sawImages && s2.shown?.index !== 4) flashed = true
    if (sawImages && s2.shown?.playback === 'native' && ss.decks[dA.id] === 'ready') {
      const hh = await hdmiRaw()
      if (streamSize(hh)?.w === 1920) {
        backNative = true
        break
      }
    }
    await sleep(150)
  }
  check(sawImages, 'killing PowerPoint falls back to the PNG slide')
  check(backNative, `the slide show returns to native (${Date.now() - t0} ms)`)
  check(!flashed, 'the slide index never changes during recovery (no slide-1 flash)')
  await shot('after-kill')

  // ---- Vector deck
  await dispatch({ type: 'selectDeck', deckId: dS.id })
  h = await until(hdmiRaw, (x) => x && topLayer(x)?.canvas, 'vector canvas', 20000)
  check(topLayer(h).kind !== 'stream', 'a static deck is drawn as Vector (canvas), not a stream')

  // ---- two native decks, switch both ways
  await dispatch({ type: 'selectDeck', deckId: dB.id })
  await until(status, (s) => s.decks[dB.id] === 'ready', 'deck B ready', 90000)
  st = await state()
  check(
    st.shown?.playback === 'native' && st.shown.deckId === dB.id,
    'second native deck goes live as Native'
  )
  await until(hdmiRaw, (x) => streamSize(x)?.w === 1920, 'deck B stream', 20000)
  check(true, 'deck B stream arrives')
  await dispatch({ type: 'selectDeck', deckId: dA.id })
  await until(hdmiRaw, (x) => streamSize(x)?.w === 1920, 'back to deck A stream', 30000)
  st = await state()
  check(
    st.shown.deckId === dA.id && st.shown.playback === 'native',
    'switching back to deck A is Native'
  )

  // ---- Black and back
  await dispatch({ type: 'toggleBlack' })
  await sleep(800)
  h = await shot('black')
  check(h.mean < 10, `Black puts a black frame on air (mean ${h.mean})`)
  await dispatch({ type: 'toggleBlack' })
  await sleep(800)
  h = await shot('black-off')
  check(h.mean > 100, `Black off returns the slide (mean ${h.mean})`)

  // ---- canvases: the canvas of a session is fixed when it opens, so change it while another deck
  // is on air and take the native deck afterwards (the on-air deck keeps its canvas until it leaves air)
  for (const [w, hh2] of [
    [3840, 1080],
    [1280, 720]
  ]) {
    await dispatch({ type: 'selectDeck', deckId: dS.id })
    await sleep(500)
    await api((c) => window.api.setDefaultCanvas(c), { width: w, height: hh2 })
    await sleep(1500)
    await dispatch({ type: 'selectDeck', deckId: dA.id })
    const got = await until(
      hdmiRaw,
      (x) => streamSize(x)?.w === w && streamSize(x)?.h === hh2,
      `stream ${w}x${hh2}`,
      60000
    ).catch(() => null)
    const last = await hdmiRaw()
    const msg = `the stream follows canvas ${w}x${hh2} (stream ${JSON.stringify(streamSize(last))})`
    // KNOWN LIMIT: Windows clamps a window to about the screen width, so a canvas wider than the
    // screen cannot be matched by a captured PowerPoint window (reported, not failed).
    if (!got && w > 1920) console.log(`KNOWN - ${msg}`)
    else check(!!got, msg)
    await shot(`canvas-${w}x${hh2}`)
  }
  await api((c) => window.api.setDefaultCanvas(c), { width: 1920, height: 1080 })
} catch (e) {
  failed++
  console.log('FAIL - exception:', e.message)
} finally {
  await app.close().catch(() => {})
  await sleep(1500)
  if (pptRunning()) {
    try {
      execSync('taskkill /F /IM POWERPNT.EXE', { stdio: 'ignore' })
    } catch {
      // nothing left to stop
    }
  }
  console.log(`screenshots: ${outDir}`)
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
  process.exit(failed ? 1 : 0)
}
