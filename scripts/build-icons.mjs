// Renders resources/brand/bridgecast-app-icon.svg to PNGs and writes
// build/icon.ico, build/icon.icns and resources/icon.png (PNG-embedded).
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'resources/brand/bridgecast-app-icon.svg'), 'utf8')
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined })
const page = await browser.newPage({ deviceScaleFactor: 1 })
const png = {}
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`
  )
  png[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } })
}
await browser.close()

// ICO
const ico = [16, 24, 32, 48, 64, 128, 256]
const head = Buffer.alloc(6 + 16 * ico.length)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(ico.length, 4)
let off = head.length
ico.forEach((s, i) => {
  const o = 6 + i * 16
  head[o] = s === 256 ? 0 : s
  head[o + 1] = s === 256 ? 0 : s
  head.writeUInt16LE(1, o + 4)
  head.writeUInt16LE(32, o + 6)
  head.writeUInt32LE(png[s].length, o + 8)
  head.writeUInt32LE(off, o + 12)
  off += png[s].length
})
writeFileSync(join(root, 'build/icon.ico'), Buffer.concat([head, ...ico.map((s) => png[s])]))

// ICNS
const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]
const chunks = types.map(([t, s]) => {
  const h = Buffer.alloc(8)
  h.write(t, 0, 'ascii')
  h.writeUInt32BE(8 + png[s].length, 4)
  return Buffer.concat([h, png[s]])
})
const total = 8 + chunks.reduce((n, c) => n + c.length, 0)
const ih = Buffer.alloc(8)
ih.write('icns', 0, 'ascii')
ih.writeUInt32BE(total, 4)
writeFileSync(join(root, 'build/icon.icns'), Buffer.concat([ih, ...chunks]))

writeFileSync(join(root, 'resources/icon.png'), png[512])
// Previews for manual checks (not part of the output)
if (process.argv[2]) for (const s of sizes) writeFileSync(join(process.argv[2], `icon-${s}.png`), png[s])
console.log('icons written')
