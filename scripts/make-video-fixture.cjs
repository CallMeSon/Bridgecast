// Generates fixtures/video-deck/: a Canva-style export folder (page-N.png + page-N.mp4).
// Run: npx electron scripts/make-video-fixture.cjs
//
// page-1 video (yellow square), page-2 image only (blue), page-3 video (red),
// page-4 video (magenta), page-5 image only (green). Each video: a square moves
// left to right over 1 s, then holds 1 s. Each video's PNG is its final frame.
// Recorded with MediaRecorder as MP4 (H.264); fails loudly if the browser cannot.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'fixtures', 'video-deck')
const W = 640
const H = 360

const PAGES = [
  { n: 1, color: '#ffd400', video: true },
  { n: 2, color: '#1e5bff', video: false },
  { n: 3, color: '#e02020', video: true },
  { n: 4, color: '#e020c8', video: true },
  { n: 5, color: '#18a83c', video: false }
]

// Runs inside the page. Returns { mp4: base64 | null, png: base64 }.
const PAGE_SCRIPT = `(async (W, H, page) => {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  document.body.append(canvas)
  const ctx = canvas.getContext('2d')
  const SIDE = 80
  const draw = (t) => {
    ctx.fillStyle = '#16181d'
    ctx.fillRect(0, 0, W, H)
    if (!page.video) {
      ctx.fillStyle = page.color
      ctx.fillRect(0, 0, W, H)
      return
    }
    const x = 40 + (W - 80 - SIDE) * Math.min(1, t)
    ctx.fillStyle = page.color
    ctx.fillRect(x, (H - SIDE) / 2, SIDE, SIDE)
  }
  const toB64 = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1])
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  let mp4 = null
  if (page.video) {
    const mime = ['video/mp4;codecs=avc1', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m)
    )
    if (!mime) throw new Error('MediaRecorder cannot record MP4 here')
    draw(0)
    const stream = canvas.captureStream(30)
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 300000 })
    const chunks = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const stopped = new Promise((resolve) => (rec.onstop = resolve))
    rec.start()
    const t0 = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000
        draw(t)
        if (t >= 2) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    draw(2)
    await new Promise((r) => setTimeout(r, 150))
    rec.stop()
    await stopped
    mp4 = await toB64(new Blob(chunks, { type: mime }))
    window.__mime = mime
  }
  draw(2)
  const png = canvas.toDataURL('image/png').split(',')[1]
  return { mp4, png, mime: window.__mime || null }
})`

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    webPreferences: { backgroundThrottling: false }
  })
  await win.loadURL('data:text/html,<body style="margin:0"></body>')
  for (const page of PAGES) {
    const r = await win.webContents.executeJavaScript(
      `${PAGE_SCRIPT}(${W}, ${H}, ${JSON.stringify(page)})`
    )
    fs.writeFileSync(path.join(OUT, `page-${page.n}.png`), Buffer.from(r.png, 'base64'))
    if (page.video) {
      const buf = Buffer.from(r.mp4, 'base64')
      fs.writeFileSync(path.join(OUT, `page-${page.n}.mp4`), buf)
      console.log(`page-${page.n}.mp4 ${buf.length} bytes (${r.mime})`)
    } else {
      console.log(`page-${page.n}.png only`)
    }
  }
}

app.whenReady().then(() =>
  main().then(
    () => app.quit(),
    (e) => {
      console.error(e)
      app.exit(1)
    }
  )
)
