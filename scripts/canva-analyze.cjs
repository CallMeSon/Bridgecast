// Analyse a Canva spike export folder without ffmpeg, using Electron's Chromium.
//   npx electron scripts/canva-analyze.cjs .superpowers/canva-spike/<designId>
// For each page-NN.mp4: duration, size, start vs end frame difference (was animation recorded?),
// end frame vs page-NN.png (does the last frame match the static export?). Writes analysis.json.

const { app, BrowserWindow } = require('electron')
const { readdirSync, writeFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const dir = resolve(process.argv[process.argv.length - 1])

const pageScript = (items) => `(async () => {
  const W = 320, H = 180
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const grab = (src) => { ctx.clearRect(0, 0, W, H); ctx.drawImage(src, 0, 0, W, H); return ctx.getImageData(0, 0, W, H).data }
  // mean absolute difference per channel, 0..255
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]); return s / (a.length / 4 * 3) }
  const seek = (v, t) => new Promise((r) => { v.onseeked = () => r(); v.currentTime = t })
  const out = []
  for (const it of ${JSON.stringify(items)}) {
    const row = { page: it.page }
    try {
      const v = document.createElement('video')
      v.muted = true; v.preload = 'auto'; v.src = it.mp4
      await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('video error ' + (v.error && v.error.code))) })
      row.duration = +v.duration.toFixed(3)
      row.size = v.videoWidth + 'x' + v.videoHeight
      await seek(v, 0); const first = grab(v)
      await seek(v, Math.max(0, v.duration * 0.5)); const mid = grab(v)
      await seek(v, Math.max(0, v.duration - 0.05)); const last = grab(v)
      row.firstVsLast = +diff(first, last).toFixed(2)
      row.firstVsMid = +diff(first, mid).toFixed(2)
      if (it.png) {
        const img = new Image(); img.src = it.png; await img.decode()
        row.lastVsPng = +diff(last, grab(img)).toFixed(2)
        row.firstVsPng = +diff(first, grab(img)).toFixed(2)
      }
    } catch (e) { row.error = String(e.message || e) }
    out.push(row)
  }
  return out
})()`

app.whenReady().then(async () => {
  const files = readdirSync(dir)
  const items = files
    .filter((f) => /^page-\d+\.mp4$/.test(f))
    .sort()
    .map((f) => {
      const page = Number(f.match(/\d+/)[0])
      const png = f.replace('.mp4', '.png')
      return {
        page,
        mp4: pathToFileURL(join(dir, f)).href,
        png: existsSync(join(dir, png)) ? pathToFileURL(join(dir, png)).href : null
      }
    })
  if (!items.length) {
    console.error('No page-NN.mp4 in ' + dir)
    app.exit(1)
    return
  }
  const win = new BrowserWindow({ show: false, webPreferences: { webSecurity: false } })
  await win.loadURL('about:blank')
  const rows = await win.webContents.executeJavaScript(pageScript(items))
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(rows, null, 2))
  console.log('page  duration  size        first~last  first~mid  last~png  first~png')
  for (const r of rows) {
    if (r.error) console.log(String(r.page).padEnd(6) + 'ERROR ' + r.error)
    else
      console.log(
        [r.page, r.duration, r.size, r.firstVsLast, r.firstVsMid, r.lastVsPng ?? '-', r.firstVsPng ?? '-']
          .map((x, i) => String(x).padEnd([6, 10, 12, 12, 11, 10, 9][i]))
          .join('')
      )
  }
  console.log('\nDiffs: mean abs per channel (0-255). first~last > ~8 suggests animation was recorded; last~png < ~6 (lossy video) means the end frame matches the static export.')
  app.quit()
})
