import { describe, it, expect, vi } from 'vitest'
import { OutputAudio } from './output-audio'

/** A hand-written AudioContext: records the graph the class builds. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the inferred type of the recorded fakes is the point
function fakeContext(
  opts: { moduleRejects?: boolean; sinkRejects?: boolean; noSinkId?: boolean; state?: string } = {}
) {
  const destination = { name: 'destination' }
  const gainNode = {
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn()
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
    createMediaStreamSource: vi.fn((stream: unknown) => {
      const s = { el: stream, connect: vi.fn(), disconnect: vi.fn() }
      sources.push(s)
      return s
    }),
    createMediaElementSource: vi.fn((el: unknown) => {
      const s = { el, connect: vi.fn(), disconnect: vi.fn() }
      sources.push(s)
      return s
    }),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    audioWorklet: {
      addModule: vi.fn(() =>
        opts.moduleRejects ? Promise.reject(new Error('blocked')) : Promise.resolve()
      )
    },
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

  it('a sink the context rejects leaves connected elements alone and is retried by the next setSink', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext()
    f.ctx.setSinkId?.mockRejectedValueOnce(new Error('no dev'))
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    await a.setSink('dev')
    // The element is in the graph: its own setSinkId would do nothing for it.
    expect(v.setSinkId).not.toHaveBeenCalled()
    expect(a.fallback).toBe(false)
    await a.setSink('dev2')
    expect(f.ctx.setSinkId).toHaveBeenCalledTimes(2)
    expect(f.ctx.setSinkId).toHaveBeenLastCalledWith('dev2')
    expect(v.setSinkId).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a sink the context rejects goes to elements outside the graph', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext({ sinkRejects: true })
    const a = new OutputAudio(() => asCtx(f.ctx))
    const ok = fakeVideo()
    a.attach(asVideo(ok))
    f.ctx.createMediaElementSource.mockImplementationOnce(() => {
      throw new Error('InvalidStateError')
    })
    const bad = fakeVideo()
    a.attach(asVideo(bad))
    await a.setSink('dev')
    expect(bad.setSinkId).toHaveBeenCalledWith('dev')
    expect(ok.setSinkId).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a context without setSinkId leaves graph elements alone and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const f = fakeContext({ noSinkId: true })
    const a = new OutputAudio(() => asCtx(f.ctx))
    const v = fakeVideo()
    a.attach(asVideo(v))
    await a.setSink('dev')
    expect(v.setSinkId).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('level reports the gain last set, or the volume of fallback elements', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    expect(a.level).toBe(1)
    a.attach(asVideo(fakeVideo()))
    a.setGain(0.4)
    expect(a.level).toBe(0.4)
    a.setGain(7)
    expect(a.level).toBe(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fb = new OutputAudio(() => {
      throw new Error('x')
    })
    const v = fakeVideo()
    fb.attach(asVideo(v))
    fb.setGain(0.3)
    expect(fb.level).toBe(0.3)
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

/** A hand-written AudioWorkletNode: records connections, exposes the port the worklet posts on. */
function fakeTapNode(): {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  port: { onmessage: ((e: { data: unknown }) => void) | null }
} {
  return { connect: vi.fn(), disconnect: vi.fn(), port: { onmessage: null } }
}

function tapSetup(opts: Parameters<typeof fakeContext>[0] = {}): {
  f: ReturnType<typeof fakeContext>
  a: OutputAudio
  node: ReturnType<typeof fakeTapNode>
  warnings: string[]
} {
  const f = fakeContext(opts)
  const node = fakeTapNode()
  const warnings: string[] = []
  const a = new OutputAudio(() => asCtx(f.ctx), {
    tapModuleUrl: 'omt-tap.worklet.js',
    makeTapNode: () => node as unknown as AudioWorkletNode,
    onWarning: (w) => warnings.push(w)
  })
  return { f, a, node, warnings }
}

const fakePort = (): { postMessage: ReturnType<typeof vi.fn> } => ({ postMessage: vi.fn() })
const asPort = (p: unknown): MessagePort => p as MessagePort

describe('OutputAudio sound plan', () => {
  it('local:false, tap:false disconnects the gain from the destination', async () => {
    const { f, a } = tapSetup()
    a.attach(asVideo(fakeVideo()))
    await a.setPlan({ local: false, tap: false }, null)
    expect(f.gainNode.disconnect).toHaveBeenCalledWith(f.destination)
    expect(f.ctx.audioWorklet.addModule).not.toHaveBeenCalled()
  })

  it('local:true, tap:true keeps the destination and adds the worklet after the gain', async () => {
    const { f, a, node } = tapSetup()
    a.attach(asVideo(fakeVideo()))
    await a.setPlan({ local: true, tap: true }, asPort(fakePort()))
    expect(f.gainNode.disconnect).not.toHaveBeenCalled()
    expect(f.gainNode.connect).toHaveBeenCalledWith(f.destination)
    expect(f.ctx.audioWorklet.addModule).toHaveBeenCalledWith('omt-tap.worklet.js')
    expect(f.gainNode.connect).toHaveBeenCalledWith(node)
  })

  it('reconnects the destination when local turns back on', async () => {
    const { f, a } = tapSetup()
    a.attach(asVideo(fakeVideo()))
    await a.setPlan({ local: false, tap: false }, null)
    f.gainNode.connect.mockClear()
    await a.setPlan({ local: true, tap: false }, null)
    expect(f.gainNode.connect).toHaveBeenCalledWith(f.destination)
  })

  it('a plan set before the first attach is applied when the context opens', async () => {
    const { f, a } = tapSetup()
    await a.setPlan({ local: false, tap: false }, null)
    a.attach(asVideo(fakeVideo()))
    expect(f.gainNode.connect).not.toHaveBeenCalledWith(f.destination)
  })

  it('forwards the worklet blocks to the port, and to the newest port', async () => {
    const { a, node } = tapSetup()
    const p1 = fakePort()
    const p2 = fakePort()
    await a.setPlan({ local: false, tap: true }, asPort(p1))
    const block = { data: new Float32Array(960), samples: 480 }
    node.port.onmessage?.({ data: block })
    expect(p1.postMessage).toHaveBeenCalledWith(block)
    await a.setPlan({ local: false, tap: true }, asPort(p2))
    const block2 = { data: new Float32Array(960), samples: 480 }
    node.port.onmessage?.({ data: block2 })
    expect(p2.postMessage).toHaveBeenCalledWith(block2)
    expect(p1.postMessage).toHaveBeenCalledTimes(1)
  })

  it('drops blocks while there is no port', async () => {
    const { a, node } = tapSetup()
    await a.setPlan({ local: false, tap: true }, null)
    expect(() =>
      node.port.onmessage?.({ data: { data: new Float32Array(960), samples: 480 } })
    ).not.toThrow()
  })

  it('removes the worklet when tap turns off', async () => {
    const { f, a, node } = tapSetup()
    await a.setPlan({ local: true, tap: true }, asPort(fakePort()))
    await a.setPlan({ local: true, tap: false }, null)
    expect(f.gainNode.disconnect).toHaveBeenCalledWith(node)
    expect(node.disconnect).toHaveBeenCalled()
  })

  it('a worklet that fails to load reports no-sound once and local sound still works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { f, a, warnings } = tapSetup({ moduleRejects: true })
    a.attach(asVideo(fakeVideo()))
    await a.setPlan({ local: true, tap: true }, asPort(fakePort()))
    await a.setPlan({ local: true, tap: true }, asPort(fakePort()))
    expect(warnings).toEqual(['no-sound'])
    expect(f.gainNode.disconnect).not.toHaveBeenCalled()
    expect(f.gainNode.connect).toHaveBeenCalledWith(f.destination)
    warn.mockRestore()
  })

  it('a fallback element is silent while local is off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = new OutputAudio(() => {
      throw new Error('x')
    })
    const v = fakeVideo()
    a.attach(asVideo(v))
    a.setGain(0.5)
    await a.setPlan({ local: false, tap: false }, null)
    expect(v.volume).toBe(0)
    await a.setPlan({ local: true, tap: false }, null)
    expect(v.volume).toBe(0.5)
    warn.mockRestore()
  })
})

describe('OutputAudio.attachStream', () => {
  const asStream = (s: unknown): MediaStream => s as MediaStream
  it('connects a captured stream to the same gain once and detaches it', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    const stream = { id: 's1' }
    expect(a.attachStream(asStream(stream))).toBe(true)
    expect(a.attachStream(asStream(stream))).toBe(true)
    expect(f.ctx.createMediaStreamSource).toHaveBeenCalledTimes(1)
    expect(f.sources[0].connect).toHaveBeenCalledWith(f.gainNode)
    // The same gain as element sound: one gain node in total.
    a.attach(asVideo(fakeVideo()))
    expect(f.ctx.createGain).toHaveBeenCalledTimes(1)
    a.detachStream(asStream(stream))
    expect(f.sources[0].disconnect).toHaveBeenCalled()
    // Attached again after a detach: a new source node.
    a.attachStream(asStream(stream))
    expect(f.ctx.createMediaStreamSource).toHaveBeenCalledTimes(2)
  })
  it('without Web Audio the stream is not attached (false)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const a = new OutputAudio(() => {
      throw new Error('no audio')
    })
    expect(a.attachStream(asStream({ id: 's2' }))).toBe(false)
    warn.mockRestore()
  })
  it('close disconnects attached streams', () => {
    const f = fakeContext()
    const a = new OutputAudio(() => asCtx(f.ctx))
    a.attachStream(asStream({ id: 's3' }))
    a.close()
    expect(f.sources[0].disconnect).toHaveBeenCalled()
  })
})
