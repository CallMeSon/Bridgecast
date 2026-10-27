import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  StreamCapture,
  STREAM_PENDING_MS,
  type CaptureHost,
  type CaptureView
} from './stream-capture'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- fakes
function fakeStream(name: string) {
  let onEnded: (() => void) | null = null
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((ev: string, cb: () => void) => {
      if (ev === 'ended') onEnded = cb
    })
  }
  const stream = { name, getVideoTracks: () => [track], getTracks: () => [track] }
  return { stream: stream as unknown as MediaStream, track, end: () => onEnded?.() }
}

const fakeVideo = (): HTMLVideoElement =>
  ({
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    srcObject: null
  }) as unknown as HTMLVideoElement

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- fakes
function setup(opts: { paused?: boolean } = {}) {
  const opened: ReturnType<typeof fakeStream>[] = []
  const frames = new Map<MediaStream, () => void>()
  let failOpen = false
  let paused = opts.paused ?? false
  let view: CaptureView = { entries: [], shownKey: null, poster: false }
  const host = {
    open: vi.fn(() => {
      if (failOpen) return Promise.reject(new Error('Web page not open'))
      const f = fakeStream(`s${opened.length + 1}`)
      opened.push(f)
      return Promise.resolve(f.stream)
    }),
    paused: () => paused,
    sound: vi.fn(),
    onView: (v: CaptureView) => {
      view = v
    },
    onReady: vi.fn(),
    onFrame: vi.fn(),
    onEnded: vi.fn(),
    onFailed: vi.fn(),
    play: (_v: HTMLVideoElement, s: MediaStream) =>
      new Promise<void>((resolve) => frames.set(s, resolve))
  } satisfies CaptureHost
  const c = new StreamCapture(host)
  const videos = new Map<number, HTMLVideoElement>()
  /** Renders: binds a <video> to every entry, like the component. */
  const render = (): void => {
    for (const e of view.entries) {
      if (!videos.has(e.key)) videos.set(e.key, fakeVideo())
      c.bind(e.key, videos.get(e.key)!)
    }
  }
  return {
    c,
    host,
    opened,
    videos,
    view: () => view,
    render,
    frame: async (i: number) => {
      frames.get(opened[i].stream)?.()
      await flush()
    },
    setPaused: (p: boolean) => {
      paused = p
      c.setPaused(p)
    },
    failOpen: (f: boolean) => {
      failOpen = f
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('StreamCapture', () => {
  it('reveals on the first frame and reports it', async () => {
    const t = setup()
    t.c.start()
    await flush()
    t.render()
    expect(t.host.onReady).not.toHaveBeenCalled()
    await t.frame(0)
    expect(t.host.onFrame).toHaveBeenCalledTimes(1)
    expect(t.host.onReady).toHaveBeenCalledTimes(1)
    expect(t.view().shownKey).toBe(1)
    expect(t.host.sound).toHaveBeenLastCalledWith(t.opened[0].stream)
  })

  it('a failed open shows the poster, warns, and captures again with a new id', async () => {
    const t = setup()
    t.failOpen(true)
    t.c.start()
    await flush()
    expect(t.view().poster).toBe(true)
    expect(t.host.onReady).toHaveBeenCalledTimes(1)
    expect(t.host.onFailed).toHaveBeenLastCalledWith(true)
    t.failOpen(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.host.open).toHaveBeenCalledTimes(2)
    t.render()
    await t.frame(0)
    expect(t.view().poster).toBe(false)
    expect(t.host.onFailed).toHaveBeenLastCalledWith(false)
  })

  it('no frame in time shows the poster and captures again until one arrives', async () => {
    const t = setup()
    t.c.start()
    await flush()
    t.render()
    await vi.advanceTimersByTimeAsync(STREAM_PENDING_MS)
    expect(t.view().poster).toBe(true)
    expect(t.host.onReady).toHaveBeenCalledTimes(1)
    expect(t.host.onFailed).toHaveBeenLastCalledWith(true)
    await vi.advanceTimersByTimeAsync(1000)
    t.render()
    await t.frame(1)
    expect(t.view().poster).toBe(false)
    expect(t.host.onFailed).toHaveBeenLastCalledWith(false)
    expect(t.host.onReady).toHaveBeenCalledTimes(1)
  })

  it('an ended track reports it, shows the poster and captures again', async () => {
    const t = setup()
    t.c.start()
    await flush()
    t.render()
    await t.frame(0)
    t.opened[0].end()
    expect(t.host.onEnded).toHaveBeenCalledTimes(1)
    expect(t.view().poster).toBe(true)
    expect(t.opened[0].track.stop).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    t.render()
    await t.frame(1)
    expect(t.view().shownKey).toBe(2)
    expect(t.view().poster).toBe(false)
    expect(t.host.onFrame).toHaveBeenCalledTimes(2)
  })

  it('while paused a new capture reports its frame but the held frame stays until resume', async () => {
    const t = setup()
    t.c.start()
    await flush()
    t.render()
    await t.frame(0)
    t.setPaused(true)
    expect(t.videos.get(1)!.pause).toHaveBeenCalled()
    t.c.capture()
    await flush()
    t.render()
    await t.frame(1)
    expect(t.host.onFrame).toHaveBeenCalledTimes(2)
    expect(t.view().shownKey).toBe(1)
    expect(t.opened[0].track.stop).not.toHaveBeenCalled()
    t.setPaused(false)
    expect(t.view().shownKey).toBe(2)
    expect(t.opened[0].track.stop).toHaveBeenCalled()
  })

  it('dispose stops every track, disconnects the sound and clears the warning', async () => {
    const t = setup()
    t.failOpen(true)
    t.c.start()
    await flush()
    t.failOpen(false)
    await vi.advanceTimersByTimeAsync(1000)
    t.render()
    t.c.dispose()
    expect(t.opened[0].track.stop).toHaveBeenCalled()
    expect(t.host.sound).toHaveBeenLastCalledWith(null)
    expect(t.host.onFailed).toHaveBeenLastCalledWith(false)
    await vi.advanceTimersByTimeAsync(10000)
    expect(t.host.open).toHaveBeenCalledTimes(2)
  })

  it('a capture without a frame in time is replaced by a new capture (new id)', async () => {
    const t = setup()
    t.c.start()
    await flush()
    t.render()
    await t.frame(0)
    t.c.capture()
    await flush()
    t.render()
    await vi.advanceTimersByTimeAsync(STREAM_PENDING_MS)
    expect(t.opened[1].track.stop).toHaveBeenCalled()
    expect(t.view().entries.map((e) => e.key)).toEqual([1])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.host.open).toHaveBeenCalledTimes(3)
    t.render()
    await t.frame(2)
    expect(t.view().shownKey).toBe(3)
  })
})
