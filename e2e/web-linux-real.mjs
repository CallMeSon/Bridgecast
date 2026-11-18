// Diagnostic (Linux): the REAL Linux web helper (native/web-bridge-linux, Chrome/Chromium) with the app, checking why a web deck
// stays on "Loading". Prints every status change, the helper window in desktopCapturer,
// what web:sourceId returns, and whether a desktop capture delivers frames.
// Run: npx electron-vite build && node e2e/web-linux-real.mjs (needs a real X11/XWayland display)
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { linuxArgs } from './launch-args.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-real-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const page = `<!doctype html><html><head><title>Real Page</title></head>
<body style="margin:0;width:100vw;height:100vh;background:#204080"><h1 style="color:#fff">hello</h1></body></html>`
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', connection: 'close' })
  res.end(page)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const app = await electron.launch({
  args: [...linuxArgs, root],
  cwd: root,
  env: {
    ...process.env,
    PPT_SHARE_USER_DATA: tmp,
    PPT_OUTPUT_DUMP: path.join(tmp, 'dump'),
    PPT_SKIP_HOME: '1',
    ELECTRON_RENDERER_URL: ''
  }
})
app.process().stdout?.on('data', (c) => process.stdout.write('[main] ' + c))
app.process().stderr?.on('data', (c) => process.stdout.write('[main!] ' + c))

try {
  const win = await app.firstWindow()
  win.on('console', (m) => console.log('[renderer]', m.type(), m.text()))
  await win.waitForSelector('.app')

  await win.click('.newbtn')
  await win.fill('[data-testid=new-event-name]', 'Real Event')
  await win.press('[data-testid=new-event-name]', 'Enter')
  await win.locator('[role=tab][aria-selected=true]', { hasText: 'Real Event' }).waitFor()
  const eventId = (await win.evaluate(() => window.api.getSession())).eventId

  const deck = await win.evaluate(([e, u]) => window.api.addWebDeck(e, u), [eventId, base + '/'])
  console.log('deck', deck.id, deck.web)

  const web = () => app.evaluate(() => globalThis.__pptWeb)
  for (let i = 0; i < 12; i++) {
    console.log(i, JSON.stringify(await web()))
    await sleep(500)
  }

  console.log('--- desktopCapturer windows ---')
  const sources = await app.evaluate(({ desktopCapturer }) =>
    desktopCapturer
      .getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 } })
      .then((list) =>
        list.map((s) => ({
          id: s.id,
          name: s.name,
          thumb: s.thumbnail.getSize()
        }))
      )
  )
  console.log(JSON.stringify(sources, null, 1))
  console.log('all windows:', JSON.stringify(sources.map((s) => s.name)))

  console.log('--- web:sourceId ---')
  const src = await win.evaluate(
    (id) => window.api.webSourceId(id).catch((e) => ({ error: String(e) })),
    deck.id
  )
  console.log(JSON.stringify(src))

  console.log('--- getUserMedia from the operator window ---')
  const got = await win.evaluate(async (source) => {
    if (source.error) return source
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
            maxWidth: 1920,
            maxHeight: 1080,
            maxFrameRate: 30
          }
        }
      })
      const v = document.createElement('video')
      v.muted = true
      v.srcObject = stream
      await v.play().catch(() => undefined)
      const frame = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 5000)
        if (v.requestVideoFrameCallback)
          v.requestVideoFrameCallback((_t, meta) => {
            clearTimeout(t)
            resolve({ w: meta.width, h: meta.height, mediaTime: meta.mediaTime })
          })
      })
      stream.getTracks().forEach((t) => t.stop())
      return { ok: true, videoWidth: v.videoWidth, videoHeight: v.videoHeight, frame }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }, src)
  console.log(JSON.stringify(got))
} finally {
  await app.close().catch(() => undefined)
  server.close()
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    // The app may still hold web.log; the temp folder is disposable.
  }
}
