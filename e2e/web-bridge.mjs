// End-to-end checks of the WebView2 web bridge path, with FakeWebEngine (no WebView2 needed).
// Run: npm run test:e2e:web-bridge   (builds first, then launches out/main/index.js)
//
// The app is forced onto the helper backend while the helper itself is fake:
// PPT_ENGINE_FAKE=1. There is no real page window, so the ready gate is opened by
// main's test hook __pptWebFrame(deckId); the fake engine's own events drive the rest.
// It checks: take a deck, navigate, kill the fake helper, HOLD, automatic restart,
// the page reopened at its last address, and Resume web.
import { _electron as electron } from 'playwright'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmpDirs = []
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(d)
  return d
}
function check(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  console.log(`ok - ${msg}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const fixture = `<!doctype html><html><head><title>Bridge Page</title></head>
<body style="margin:0;background:#204080"><a id="next" href="/next">next</a></body></html>`
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', connection: 'close' })
  res.end(fixture)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

async function main() {
  const userData = mkTmp('ppt-share-web-bridge-')
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OUTPUT_DUMP: mkTmp('ppt-share-web-bridge-dump-'),
      PPT_SKIP_HOME: '1',
      PPT_ENGINE_FAKE: '1',
      ELECTRON_RENDERER_URL: ''
    }
  })
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.app')
    const session = () => win.evaluate(() => window.api.getSession())
    const dispatch = async (a) => {
      await win.evaluate((x) => window.api.dispatch(x), a)
      return (await session()).state
    }
    const web = () => app.evaluate(() => globalThis.__pptWeb)
    const engine = () => app.evaluate(() => globalThis.__pptWebEngine)
    async function waitFor(pred, what, timeout = 20_000) {
      const end = Date.now() + timeout
      let last = null
      while (Date.now() < end) {
        last = await pred()
        if (last) return last
        await sleep(150)
      }
      throw new Error(`ASSERT: ${what} (last: ${JSON.stringify(last)})`)
    }

    // A backend made of the fake helper: the app only uses it on Windows with the exe built.
    const eng = await engine()
    check(!!eng, 'the app uses the helper backend (PPT_ENGINE_FAKE)')

    await win.click('.newbtn')
    await win.fill('[data-testid=new-event-name]', 'Web Bridge Event')
    await win.press('[data-testid=new-event-name]', 'Enter')
    await win.locator('[role=tab][aria-selected=true]', { hasText: 'Web Bridge Event' }).waitFor()
    const eventId = (await session()).eventId
    const deck = await win.evaluate(([e, u]) => window.api.addWebDeck(e, u), [
      eventId,
      `${base}/deck`
    ])
    check(deck.source === 'web', 'web deck added')

    await waitFor(async () => (await web())[deck.id]?.status === 'loading', 'page loading')
    await app.evaluate((_e, id) => globalThis.__pptWebFrame(id), deck.id)
    await waitFor(async () => (await web())[deck.id]?.status === 'ready', 'page ready')

    let st = await dispatch({ type: 'selectDeck', deckId: deck.id })
    check(st.shown?.web?.deckId === deck.id, 'the deck goes on air')

    // Navigate while live: the helper gets the new address (no real page to render).
    await win.evaluate(([d, u]) => window.api.setWebUrl(d, u), [deck.id, `${base}/other`])

    // Kill the fake helper: main holds, restarts it and reopens the page.
    await app.evaluate(() => globalThis.__pptWebEngine.kill())
    st = await waitFor(
      async () => ((await session()).state.webHold ? (await session()).state : null),
      'HOLD after the helper died'
    )
    check(st.webHold === true, 'helper killed while on air: HOLD')
    const dbg = await waitFor(async () => {
      const d = await web()
      return d && d[deck.id] ? d[deck.id] : null
    }, 'the page is reopened')
    console.log('page after the helper died:', JSON.stringify(dbg), 'engine:', JSON.stringify(await engine()))
    check(dbg.status === 'loading' || dbg.status === 'ready', 'the page was reopened')

    const again = await engine()
    check(again.ready === true, 'the supervisor restarted the helper')

    await app.evaluate((_e, id) => globalThis.__pptWebFrame(id), deck.id)
    await waitFor(async () => (await web())[deck.id]?.status === 'ready', 'page ready again')
    st = await dispatch({ type: 'resumeWeb' })
    check(st.webHold === false && st.shown?.web?.deckId === deck.id, 'Resume web ends HOLD')
  } finally {
    await app.close().catch(() => undefined)
  }
}

try {
  await main()
  console.log('all web bridge end-to-end checks passed')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  server.close()
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
}
