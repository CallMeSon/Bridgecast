import fs from 'node:fs'
import path from 'node:path'

type FolderDeck = {
  name: string
  width: number
  height: number
  slides: { pngPath: string; notes: ''; videoPath?: string }[]
}

const PAGE_RE = /^page-(\d+)\.(png|mp4)$/i
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width and height from the PNG header (IHDR: big-endian, bytes 16-23). */
export function pngSize(file: string): { width: number; height: number } {
  const fail = (): never => {
    throw new Error(
      `${path.basename(file)} is not a readable PNG image. Export the page again, then import the folder again.`
    )
  }
  const head = Buffer.alloc(24)
  let read = 0
  try {
    const fd = fs.openSync(file, 'r')
    try {
      read = fs.readSync(fd, head, 0, 24, 0)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return fail()
  }
  if (read < 24 || !head.subarray(0, 8).equals(PNG_SIGNATURE)) return fail()
  const width = head.readUInt32BE(16)
  const height = head.readUInt32BE(20)
  if (width === 0 || height === 0) return fail()
  return { width, height }
}

/** Reads a folder of page-NN.png (required) and page-NN.mp4 (optional) as a deck. */
export function readFolderDeck(dir: string): FolderDeck {
  type Page = { png?: string; mp4?: string; label: string }
  const pages = new Map<number, Page>()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const m = entry.isFile() ? PAGE_RE.exec(entry.name) : null
    if (!m) continue
    const n = Number(m[1])
    const page = pages.get(n) ?? { label: m[1] }
    if (m[2].toLowerCase() === 'png') page.png = path.join(dir, entry.name)
    else page.mp4 = path.join(dir, entry.name)
    pages.set(n, page)
  }
  if (![...pages.values()].some((p) => p.png)) {
    throw new Error(
      'This folder has no page-NN.png files. Choose a folder exported from Canva (page-01.png, page-01.mp4, ...).'
    )
  }
  const ordered = [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  const slides = ordered.map((p) => {
    if (!p.png) {
      throw new Error(
        `Page ${p.label} has a video but no page-${p.label}.png. Export that page again, then import the folder again.`
      )
    }
    return p.mp4
      ? { pngPath: p.png, notes: '' as const, videoPath: p.mp4 }
      : { pngPath: p.png, notes: '' as const }
  })
  // Every page is checked, so a bad export is named before any page is converted.
  const sizes = slides.map((s) => pngSize(s.pngPath))
  const { width, height } = sizes[0]
  return { name: path.basename(dir), width, height, slides }
}
