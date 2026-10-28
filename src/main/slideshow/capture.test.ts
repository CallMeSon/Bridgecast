import { describe, it, expect } from 'vitest'
import { slideshowSourceId, sourceIdForWindow, SOURCE_NOT_FOUND } from './capture'

const sources = [
  { id: 'screen:0:0' },
  { id: 'window:1324:0' },
  { id: 'window:13240:0' },
  { id: 'window:99:1' }
]

describe('sourceIdForWindow', () => {
  it('finds the window source of the HWND the bridge reported', () => {
    expect(sourceIdForWindow(sources, '1324')).toBe('window:1324:0')
    expect(sourceIdForWindow(sources, '99')).toBe('window:99:1')
  })
  it('matches the whole handle, not a prefix of a longer one', () => {
    expect(sourceIdForWindow([{ id: 'window:13240:0' }], '1324')).toBeNull()
  })
  it('is null when the window is not in the list', () => {
    expect(sourceIdForWindow(sources, '5')).toBeNull()
    expect(sourceIdForWindow([], '1324')).toBeNull()
  })
  it('never returns a screen, whatever the handle looks like', () => {
    expect(sourceIdForWindow([{ id: 'screen:1324:0' }], '1324')).toBeNull()
    expect(sourceIdForWindow([{ id: 'screen:0:0' }], 'screen')).toBeNull()
    expect(sourceIdForWindow([{ id: 'screen:0:0' }], '0')).toBeNull()
  })
  it('refuses an empty or malformed handle', () => {
    expect(sourceIdForWindow(sources, '')).toBeNull()
    expect(sourceIdForWindow([{ id: 'window::0' }], '')).toBeNull()
    expect(sourceIdForWindow(sources, '1324:0')).toBeNull()
  })
})

describe('slideshowSourceId', () => {
  it('asks for windows only and returns the deck window id', async () => {
    const asked: unknown[] = []
    const id = await slideshowSourceId('1324', async (types) => {
      asked.push(types)
      return sources
    })
    expect(id).toBe('window:1324:0')
    expect(asked).toEqual([['window']])
  })
  it('throws when the deck has no slide show window (no desktop fallback)', async () => {
    let called = false
    await expect(
      slideshowSourceId(null, async () => {
        called = true
        return sources
      })
    ).rejects.toThrow(SOURCE_NOT_FOUND)
    expect(called).toBe(false)
  })
  it('throws when the window is not listed, and when the capturer fails', async () => {
    await expect(slideshowSourceId('5', async () => sources)).rejects.toThrow(SOURCE_NOT_FOUND)
    await expect(
      slideshowSourceId('1324', async () => {
        throw new Error('denied')
      })
    ).rejects.toThrow(SOURCE_NOT_FOUND)
  })
})
