// NDI verification on this machine, using the same library as the app (grandi,
// NDI 6 runtime bundled with @grandi/win32-x64). Needs no NDI Tools.
//
//   npm run verify:ndi        (builds the app first)
//
// Pass 1: a sender in this process sends solid-colour frames (1920×1080 and
//         3840×2160); NDI discovery finds it and a receiver checks size + colour.
// Pass 2: launches the real app (Playwright/Electron), finds its source
//         "<PC> (PPT Share)", and checks the received frames: slide 1 is not
//         black, B makes it black, B again restores it, 3840×2160 @ 60 fps
//         arrives at 4K after "Terapkan", and reports the per-frame cost.
import { _electron as electron } from 'playwright'
import grandi from 'grandi'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = os.hostname().toUpperCase()
let failures = 0

function check(cond, msg) {
  if (cond) console.log(`ok - ${msg}`)
  else {
    failures++
    console.log(`NOT OK - ${msg}`)
  }
}

/** Finds "<this PC> (<name>)" via NDI discovery. */
async function findSource(name, timeout = 15_000) {
  const finder = await grandi.find({ showLocalSources: true })
  try {
    const want = `${host} (${name})`.toUpperCase()
    const end = Date.now() + timeout
    while (Date.now() < end) {
      await finder.wait(500)
      const s = finder.sources().find((x) => x.name.toUpperCase() === want)
      if (s) return s
    }
    throw new Error(
      `source "${want}" not found; seen: ${JSON.stringify(finder.sources().map((s) => s.name))}`
    )
  } finally {
    finder.destroy()
  }
}

/** [r,g,b] at (x,y) of a received BGRA frame. */
function px(f, x, y) {
  const i = y * f.lineStrideBytes + x * 4
  return [f.data[i + 2], f.data[i + 1], f.data[i]]
}
const lum = (p) => Math.max(...p)

/** Receives frames until `pred(frame)` holds; returns that frame. */
async function waitFrame(rx, pred, what, timeout = 8000) {
  const end = Date.now() + timeout
  let last = null
  while (Date.now() < end) {
    try {
      last = await rx.video(1000)
    } catch {
      continue
    }
    if (pred(last)) return last
  }
  throw new Error(
    `${what} (last frame: ${last ? `${last.xres}×${last.yres} centre ${px(last, last.xres >> 1, last.yres >> 1)}` : 'none'})`
  )
}

// ---------------------------------------------------------------- pass 1
async function solidPass() {
  console.log(`# pass 1: solid colour via grandi (${grandi.version()})`)
  grandi.initialize()
  for (const [W, H, colour] of [
    [1920, 1080, [224, 128, 32]],
    [3840, 2160, [32, 200, 96]]
  ]) {
    const name = `PPT Share Verify ${W}`
    const sender = await grandi.send({ name, clockVideo: false })
    const buf = Buffer.alloc(W * H * 4)
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = colour[2]
      buf[i + 1] = colour[1]
      buf[i + 2] = colour[0]
      buf[i + 3] = 255
    }
    let busy = false
    const timer = setInterval(() => {
      if (busy) return
      busy = true
      sender
        .video({
          xres: W,
          yres: H,
          frameRateN: 30,
          frameRateD: 1,
          pictureAspectRatio: W / H,
          fourCC: grandi.FourCC.BGRX,
          frameFormatType: grandi.FrameType.Progressive,
          lineStrideBytes: W * 4,
          data: buf
        })
        .finally(() => (busy = false))
    }, 33)
    let rx
    try {
      const src = await findSource(name)
      check(true, `discovered "${src.name}" at ${src.urlAddress}`)
      rx = await grandi.receive({ source: src, colorFormat: grandi.ColorFormat.BGRX_BGRA })
      const f = await waitFrame(rx, () => true, 'no frame received')
      const pts = [
        [0, 0],
        [W >> 1, H >> 1],
        [W - 1, H - 1]
      ].map(([x, y]) => px(f, x, y))
      check(
        f.xres === W && f.yres === H && f.frameRateN === 30 && f.frameRateD === 1,
        `received ${f.xres}×${f.yres} @ ${f.frameRateN}/${f.frameRateD}, progressive=${f.frameFormatType === 1}`
      )
      check(
        pts.every((p) => p.every((c, i) => Math.abs(c - colour[i]) <= 2)),
        `solid colour ${JSON.stringify(colour)} received as ${JSON.stringify(pts)}`
      )
      check(sender.connections() > 0, `sender reports ${sender.connections()} connection(s)`)
    } finally {
      rx?.destroy()
      clearInterval(timer)
      sender.destroy()
    }
  }
}

// ---------------------------------------------------------------- pass 2
async function appPass() {
  console.log('# pass 2: the real app (Playwright → Electron)')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-ndi-'))
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      PPT_SHARE_USER_DATA: userData,
      PPT_OUTPUT_DUMP: path.join(userData, 'frames'),
      ELECTRON_RENDERER_URL: ''
    }
  })
  let rx
  try {
    const win = await app.firstWindow()
    await win.waitForSelector('.app')
    await win.locator('[data-testid=ndi-status][data-tone=ok]').waitFor({ timeout: 15_000 })
    check(true, `app header: "${await win.getByTestId('ndi-status').textContent()}"`)

    await win.click('.event-btn')
    await win.getByRole('menuitem', { name: 'Event baru' }).click()
    await win.fill('.event-input', 'NDI Verify')
    await win.press('.event-input', 'Enter')
    await win.setInputFiles('[data-testid=file-input]', path.join(root, 'fixtures/sample.pdf'))
    await win.locator('.deck .meta', { hasText: '3 slide' }).waitFor({ timeout: 60_000 })

    const src = await findSource('PPT Share')
    check(true, `discovered the app's source "${src.name}"`)
    rx = await grandi.receive({ source: src, colorFormat: grandi.ColorFormat.BGRX_BGRA })

    const standby = await waitFrame(rx, () => true, 'no frame from the app')
    check(
      standby.xres === 1920 && standby.yres === 1080 && standby.frameRateN === 30,
      `app frame ${standby.xres}×${standby.yres} @ ${standby.frameRateN}/${standby.frameRateD}`
    )
    check(lum(px(standby, 960, 300)) <= 8, 'STANDBY (nothing shown) is black over NDI')

    await win.keyboard.press('Space') // take slide 1 live
    const live = await waitFrame(
      rx,
      (f) => lum(px(f, 960, 300)) > 200 && lum(px(f, 10, 10)) > 200,
      'slide 1 never arrived over NDI'
    )
    check(
      true,
      `slide 1 over NDI is not black: centre ${px(live, 960, 300)}, corner ${px(live, 10, 10)}`
    )

    await win.keyboard.press('b')
    const black = await waitFrame(
      rx,
      (f) =>
        [
          [10, 10],
          [960, 540],
          [960, 300],
          [1910, 1070]
        ].every(([x, y]) => lum(px(f, x, y)) <= 8),
      'B did not make the NDI frame black'
    )
    check(true, `B → NDI frame black (centre ${px(black, 960, 540)})`)
    await win.keyboard.press('b')
    await waitFrame(rx, (f) => lum(px(f, 960, 300)) > 200, 'B off did not restore slide 1')
    check(true, 'B again → slide 1 back over NDI')

    // 4K @ 60 fps through the same path the popover uses.
    const t0 = Date.now()
    await win.evaluate(() =>
      window.api.setSettings({
        ndi: { enabled: true, name: 'PPT Share', width: 3840, height: 2160, fps: 60 }
      })
    )
    const uhd = await waitFrame(
      rx,
      (f) => f.xres === 3840 && lum(px(f, 1920, 600)) > 200,
      'no 3840×2160 frame after switching to 4K',
      15_000
    )
    check(
      uhd.yres === 2160 && uhd.frameRateN === 60 && uhd.frameRateD === 1,
      `after Terapkan 4K/60: ${uhd.xres}×${uhd.yres} @ ${uhd.frameRateN}/${uhd.frameRateD} received ${Date.now() - t0} ms later, slide visible`
    )
    // Count frames received in 3 s (a gap would show as a long wait).
    let n = 0
    let maxGap = 0
    let prev = Date.now()
    const end = Date.now() + 3000
    while (Date.now() < end) {
      try {
        await rx.video(1000)
        n++
        maxGap = Math.max(maxGap, Date.now() - prev)
        prev = Date.now()
      } catch {
        /* timeout */
      }
    }
    console.log(`  received ${n} frames in 3 s at 4K/60 (longest gap ${maxGap} ms)`)
    check(n >= 60, `4K/60 keeps flowing over NDI (${n} frames in 3 s)`)

    const paint = await app.evaluate(() => globalThis.__pptOutput.paint)
    const ndi = await app.evaluate(() => globalThis.__pptNdi)
    console.log(
      `  4K main-thread cost per painted frame: ${(paint.totalMs / paint.count).toFixed(1)} ms avg / ${paint.maxMs.toFixed(1)} ms max over ${paint.count} paints (scale ${paint.scaleFactor}, window ${paint.windowDip.width}×${paint.windowDip.height} DIP, painted ${paint.painted?.width}×${paint.painted?.height}, mode ${paint.mode})`
    )
    console.log(
      `  NDI sends (worker thread, whole run): ${ndi.sent} sent, ${ndi.dropped} dropped, ${(ndi.sendMsTotal / ndi.sent).toFixed(1)} ms avg / ${ndi.sendMsMax.toFixed(1)} ms max`
    )
    // A change on the slide repaints at 4K: measure that path too.
    // Slide 2 of sample.pdf has a light-blue background (232,240,255); slide 1 is white.
    await win.keyboard.press('Space')
    const isBlue = ([r, g, b]) => r < 245 && b > 245 && b - r > 10 && g > r
    const s2 = await waitFrame(
      rx,
      (f) => f.xres === 3840 && isBlue(px(f, 20, 20)),
      'slide 2 at 4K',
      8000
    )
    check(true, `slide 2 over NDI at 4K: corner ${px(s2, 20, 20)} (light blue)`)
    const paint2 = await app.evaluate(() => globalThis.__pptOutput.paint)
    console.log(
      `  after a slide change at 4K: ${(paint2.totalMs / paint2.count).toFixed(1)} ms avg / ${paint2.maxMs.toFixed(1)} ms max over ${paint2.count} paints`
    )
    check(paint2.mode !== 'resize', `4K frames are not resampled (mode ${paint2.mode})`)
  } finally {
    rx?.destroy()
    await app.close()
    fs.rmSync(userData, { recursive: true, force: true })
  }
}

try {
  await solidPass()
  await appPass()
} catch (e) {
  failures++
  console.error(e)
}
console.log(failures ? `NDI VERIFY FAILED (${failures})` : 'NDI VERIFY PASSED')
process.exit(failures ? 1 : 0)
