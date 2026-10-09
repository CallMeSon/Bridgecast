import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pngSize, readFolderDeck } from './folder'

const FIXTURE = path.resolve(__dirname, '../../../fixtures/video-deck')

/** The signature and IHDR of a PNG of the given size (enough for pngSize). */
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

const dirs: string[] = []
function makeDir(files: Record<string, Buffer | string>, name = 'Canva export'): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-folder-'))
  dirs.push(parent)
  const dir = path.join(parent, name)
  fs.mkdirSync(dir)
  for (const [f, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), data)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const png = pngHeader(320, 180)
const mp4 = Buffer.from('not really an mp4')

describe('readFolderDeck', () => {
  it('orders pages numerically', () => {
    const dir = makeDir({ 'page-10.png': png, 'page-9.png': png, 'page-1.png': png })
    const deck = readFolderDeck(dir)
    expect(deck.slides.map((s) => path.basename(s.pngPath))).toEqual([
      'page-1.png',
      'page-9.png',
      'page-10.png'
    ])
  })

  it('pairs videos with pages; pages without video are images', () => {
    const dir = makeDir({
      'page-1.png': png,
      'page-1.mp4': mp4,
      'page-2.png': png,
      'page-3.png': png,
      'page-3.mp4': mp4
    })
    const deck = readFolderDeck(dir)
    expect(deck.slides.map((s) => (s.videoPath ? path.basename(s.videoPath) : null))).toEqual([
      'page-1.mp4',
      null,
      'page-3.mp4'
    ])
    for (const s of deck.slides) {
      expect(s.notes).toBe('')
      expect(fs.existsSync(s.pngPath)).toBe(true)
    }
    expect('videoPath' in deck.slides[1]).toBe(false)
  })

  it('pairs zero-padded names (page-01 with page-1 style numbers)', () => {
    const dir = makeDir({ 'page-01.png': png, 'page-01.mp4': mp4, 'page-02.png': png })
    const deck = readFolderDeck(dir)
    expect(deck.slides).toHaveLength(2)
    expect(path.basename(deck.slides[0].videoPath!)).toBe('page-01.mp4')
    expect(deck.slides[1].videoPath).toBeUndefined()
  })

  it('ignores other files and is case-insensitive', () => {
    const dir = makeDir({
      'page-1.png': png,
      'PAGE-2.PNG': png,
      'PAGE-2.MP4': mp4,
      'report.json': '{}',
      'page-x.png': png,
      'cover.png': png,
      'page-3.jpg': png
    })
    const deck = readFolderDeck(dir)
    expect(deck.slides.map((s) => path.basename(s.pngPath))).toEqual(['page-1.png', 'PAGE-2.PNG'])
    expect(path.basename(deck.slides[1].videoPath!)).toBe('PAGE-2.MP4')
  })

  it('names the deck after the folder', () => {
    const dir = makeDir({ 'page-1.png': png }, 'Annual Meeting')
    expect(readFolderDeck(dir).name).toBe('Annual Meeting')
  })

  it('reads the size from the first PNG', () => {
    const deck = readFolderDeck(FIXTURE)
    expect({ width: deck.width, height: deck.height }).toEqual({ width: 640, height: 360 })
    expect(deck.slides).toHaveLength(5)
    expect(deck.slides.map((s) => !!s.videoPath)).toEqual([true, false, true, true, false])
  })

  it('fails when the folder has no page PNG at all', () => {
    const message =
      'This folder has no page-NN.png files. Choose a folder exported from Canva (page-01.png, page-01.mp4, ...).'
    expect(() => readFolderDeck(makeDir({ 'readme.txt': 'hi' }))).toThrow(message)
    expect(() => readFolderDeck(makeDir({}))).toThrow(message)
    expect(() => readFolderDeck(makeDir({ 'page-1.mp4': mp4 }))).toThrow(message)
  })

  it('fails when a video has no PNG, naming the page as in the file name', () => {
    const dir = makeDir({ 'page-01.png': png, 'page-02.mp4': mp4 })
    expect(() => readFolderDeck(dir)).toThrow(
      'Page 02 has a video but no page-02.png. Export that page again, then import the folder again.'
    )
  })

  it('fails when the first PNG cannot be read', () => {
    const dir = makeDir({ 'page-1.png': 'garbage' })
    expect(() => readFolderDeck(dir)).toThrow(
      `page-1.png is not a readable PNG image. Export the page again, then import the folder again.`
    )
  })
})

describe('pngSize', () => {
  it('reads width and height from the IHDR (big-endian)', () => {
    const dir = makeDir({ 'a.png': pngHeader(1920, 1080) })
    expect(pngSize(path.join(dir, 'a.png'))).toEqual({ width: 1920, height: 1080 })
  })

  it('rejects a file without the PNG signature', () => {
    const dir = makeDir({ 'a.png': Buffer.alloc(40) })
    expect(() => pngSize(path.join(dir, 'a.png'))).toThrow(/is not a readable PNG image/)
  })

  it('rejects a zero-sized or truncated file', () => {
    const dir = makeDir({
      'zero.png': pngHeader(0, 0),
      'short.png': pngHeader(1, 1).subarray(0, 10)
    })
    expect(() => pngSize(path.join(dir, 'zero.png'))).toThrow(/is not a readable PNG image/)
    expect(() => pngSize(path.join(dir, 'short.png'))).toThrow(/is not a readable PNG image/)
  })
})
