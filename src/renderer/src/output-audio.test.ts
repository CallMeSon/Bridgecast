import { describe, it, expect, vi } from 'vitest'
import { OutputAudio } from './output-audio'

/** A hand-written AudioContext: records the graph the class builds. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the inferred type of the recorded fakes is the point
function fakeContext(opts: { sinkRejects?: boolean; noSinkId?: boolean; state?: string } = {}) {
  const destination = { name: 'destination' }
  const gainNode = {
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn()
  }
  const sources: {
    el: unknown
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }[] = []
  const ctx = {
    currentTime: 12.5,
    state: opts.state ?? 'running',
    destination,
    createGain: vi.fn(() => gainNode),
    createMediaElementSource: vi.fn((el: unknown) => {
      const s = { el, connect: vi.fn(), disconnect: vi.fn() }
      sources.push(s)
      return s
    }),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    ...(opts.noSinkId
      ? {}
      : {
          setSinkId: vi.fn((id: string) =>
            opts.sinkRejects ? Promise.reject(new Error(`no ${id}`)) : Promise.resolve()
          )
        })
  }
  return { ctx, gainNode, destination, sources }
}

function fakeVideo(): { volume: number; setSinkId: ReturnType<typeof vi.fn> } {
  return { volume: 1, setSinkId: vi.fn(() => Promise.resolve()) }
}

const asCtx = (c: unknown): AudioContext => c as AudioContext
const asVideo = (v: unknown): HTMLVideoElement => v as HTMLVideoElement

describe('OutputAudio', () => {
  it('connects an element to the shared gain and the destination once, even if attached twice', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    a.attach(asVideo(v))
    expect(f.ctx.createMediaElementSource).toHaveBeenCalledTimes(1)
    expect(f.sources[0].connect).toHaveBeenCalledTimes(1)
    expect(f.sources[0].connect).toHaveBeenCalledWith(f.gainNode)
    expect(f.gainNode.connect).toHaveBeenCalledWith(f.destination)
    expect(a.fallback).toBe(false)
  })

  it('shares one gain node between elements', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    a.attach(asVideo(fakeVideo()))
    a.attach(asVideo(fakeVideo()))
    expect(f.ctx.createGain).toHaveBeenCalledTimes(1)
    expect(f.ctx.createMediaElementSource).toHaveBeenCalledTimes(2)
  })

  it('setGain ramps with setTargetAtTime(g, currentTime, 0.015)', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    a.attach(asVideo(fakeVideo()))
    a.setGain(0.25)
    expect(f.gainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.25, 12.5, 0.015)
  })

  it('a gain set before the first attach is the starting gain', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    a.setGain(0.5)
    a.attach(asVideo(fakeVideo()))
    expect(f.gainNode.gain.value).toBe(0.5)
  })

  it('resumes a suspended context so sound plays; a rejected resume is only logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext({ state: 'suspended' })
    f.ctx.resume.mockImplementation(() => Promise.reject(new Error('blocked')))
    const a = new OutputAudio(() => asCtx(f.ctx))
    a.attach(asVideo(fakeVideo()))
    expect(f.ctx.resume).toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
    expect(a.fallback).toBe(false)
    warn.mockRestore()
  })

  it('falls back to element volume when the context cannot be created, logging once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = new OutputAudio(() => {
      throw new Error('no AudioContext')
    })
    const v1 = fakeVideo()
    const v2 = fakeVideo()
    a.attach(asVideo(v1))
    a.attach(asVideo(v2))
    expect(a.fallback).toBe(true)
    a.setGain(0.4)
    expect(v1.volume).toBe(0.4)
    expect(v2.volume).toBe(0.4)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a gain set before attach reaches a fallback element', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = new OutputAudio(() => {
      throw new Error('x')
    })
    a.setGain(0.3)
    const v = fakeVideo()
    a.attach(asVideo(v))
    expect(v.volume).toBe(0.3)
    warn.mockRestore()
  })

  it('falls back when createMediaElementSource throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext()
    f.ctx.createMediaElementSource.mockImplementation(() => {
      throw new Error('InvalidStateError')
    })
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    expect(a.fallback).toBe(true)
    a.setGain(0.6)
    expect(v.volume).toBe(0.6)
    warn.mockRestore()
  })

  it('an element that cannot connect uses its volume while connected ones stay in the graph', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    const ok = fakeVideo()
    const bad = fakeVideo()
    a.attach(asVideo(ok))
    f.ctx.createMediaElementSource.mockImplementationOnce(() => {
      throw new Error('InvalidStateError')
    })
    a.attach(asVideo(bad))
    a.setGain(0.5)
    expect(f.sources[0].disconnect).not.toHaveBeenCalled()
    expect(f.gainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 12.5, 0.015)
    expect(bad.volume).toBe(0.5)
    expect(ok.volume).toBe(1)
    warn.mockRestore()
  })

  it('routes the sink through the context', async () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    await a.setSink('dev')
    expect(f.ctx.setSinkId).toHaveBeenCalledWith('dev')
    expect(v.setSinkId).not.toHaveBeenCalled()
  })

  it('a sink the context rejects goes to the elements instead', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext({ sinkRejects: true })
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    await a.setSink('dev')
    expect(v.setSinkId).toHaveBeenCalledWith('dev')
    expect(a.fallback).toBe(false)
    warn.mockRestore()
  })

  it('a context without setSinkId uses the elements', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext({ noSinkId: true })
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    await a.setSink('dev')
    expect(v.setSinkId).toHaveBeenCalledWith('dev')
    warn.mockRestore()
  })

  it('in fallback the sink always goes to the elements, also for later ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = new OutputAudio(() => {
      throw new Error('x')
    })
    const v1 = fakeVideo()
    a.attach(asVideo(v1))
    await a.setSink('dev')
    expect(v1.setSinkId).toHaveBeenCalledWith('dev')
    const v2 = fakeVideo()
    a.attach(asVideo(v2))
    expect(v2.setSinkId).toHaveBeenCalledWith('dev')
    warn.mockRestore()
  })

  it('a sink chosen before the first attach is applied to the new context', async () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    await a.setSink('dev')
    a.attach(asVideo(fakeVideo()))
    expect(f.ctx.setSinkId).toHaveBeenCalledWith('dev')
  })

  it('detach disconnects the element; close closes the context', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    a.detach(asVideo(v))
    expect(f.sources[0].disconnect).toHaveBeenCalled()
    a.close()
    expect(f.ctx.close).toHaveBeenCalled()
  })
})
