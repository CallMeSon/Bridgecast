import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readVideoDeck, VIDEO_CANNOT_PLAY, type GrabPoster } from './video-file'

const dirs: string[] = []
function temp(name: string, data: Buffer | string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-video-'))
  dirs.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, data)
  return file
}

function outDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-share-video-out-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const PNG = Buffer.from('pretend this is a poster png')
const clip = (): string => temp('Intro Clip.MP4', Buffer.from('video bytes'))

const grabOk: GrabPoster = async () => ({ png: PNG, width: 1280, height: 720 })

describe('readVideoDeck', () => {
  it('builds a one-slide deck named after the file', async () => {
    const file = clip()
    const out = outDir()
    const deck = await readVideoDeck(file, out, grabOk)
    expect(deck.name).toBe('Intro Clip')
    expect(deck.width).toBe(1280)
    expect(deck.height).toBe(720)
    expect(deck.slides).toHaveLength(1)
    expect(deck.slides[0].videoPath).toBe(file)
    expect(deck.slides[0].notes).toBe('')
    expect(fs.readFileSync(deck.slides[0].pngPath)).toEqual(PNG)
  })

  it('refuses a video that cannot be played and writes no poster', async () => {
    const out = outDir()
    const grab: GrabPoster = async () => {
      throw new Error('decode failed')
    }
    await expect(readVideoDeck(clip(), out, grab)).rejects.toThrow(VIDEO_CANNOT_PLAY)
    expect(fs.readdirSync(out)).toEqual([])
  })

  it('refuses an empty file without calling the grab', async () => {
    const out = outDir()
    let called = false
    const grab: GrabPoster = async () => {
      called = true
      return { png: PNG, width: 1, height: 1 }
    }
    await expect(readVideoDeck(temp('empty.mp4', Buffer.alloc(0)), out, grab)).rejects.toThrow(
      'This video file is empty. Choose another file.'
    )
    expect(called).toBe(false)
  })

  it('refuses a missing file', async () => {
    const out = outDir()
    await expect(readVideoDeck(path.join(out, 'gone.mp4'), out, grabOk)).rejects.toThrow(
      'Could not read this video file. Check that it still exists, then add it again.'
    )
  })

  it('refuses a zero-size poster', async () => {
    const out = outDir()
    const grab: GrabPoster = async () => ({ png: PNG, width: 0, height: 720 })
    await expect(readVideoDeck(clip(), out, grab)).rejects.toThrow(VIDEO_CANNOT_PLAY)
    const tall: GrabPoster = async () => ({ png: PNG, width: 1280, height: 0 })
    await expect(readVideoDeck(clip(), outDir(), tall)).rejects.toThrow(VIDEO_CANNOT_PLAY)
  })

  it('refuses a file that is not a video extension', async () => {
    const out = outDir()
    await expect(readVideoDeck(temp('notes.txt', 'hi'), out, grabOk)).rejects.toThrow(
      VIDEO_CANNOT_PLAY
    )
  })

  it('accepts MOV and MKV files like MP4', async () => {
    for (const name of ['clip.mov', 'clip.MKV']) {
      const deck = await readVideoDeck(temp(name, Buffer.from('video bytes')), outDir(), grabOk)
      expect(deck.slides).toHaveLength(1)
      expect(deck.slides[0].videoPath).toContain(name)
      expect(deck.name).toBe('clip')
    }
  })
})
