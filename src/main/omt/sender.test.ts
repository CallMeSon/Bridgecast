import { readFileSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OmtSender, type SendTarget } from './sender'
import { OmtLoadError } from './binding'
import { FakeSenderBinding } from '../net/fake-binding'
import type { OmtStatus } from '../../shared/omt'

const LOAD_MSG = 'OMT could not start: its library is missing. Reinstall PPT Share.'
const CREATE_MSG = 'OMT could not start. Close other apps that send OMT, then turn OMT off and on.'

const frame = (): { width: number; height: number; data: ArrayBuffer } => ({
  width: 4,
  height: 2,
  data: new ArrayBuffer(32)
})

function setup(
  binding: () => FakeSenderBinding,
  id: 'omt' | 'ndi' = 'omt'
): { reports: Partial<OmtStatus>[]; target: SendTarget } {
  const reports: Partial<OmtStatus>[] = []
  const target: SendTarget = { id, name: 'Show', binding, report: (s) => reports.push(s) }
  return { reports, target }
}

describe('OmtSender', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports running with the binding address on start', () => {
    const fake = new FakeSenderBinding('omt')
    const { reports, target } = setup(() => fake)
    new OmtSender().start({ targets: [target], fps: 30, width: 4, height: 2 })
    expect(reports.at(-1)).toMatchObject({ state: 'running', address: 'omt://fake' })
    expect(fake.names).toEqual(['Show'])
  })

  it('sends a pushed frame on each tick', () => {
    const fake = new FakeSenderBinding('omt')
    const { target } = setup(() => fake)
    const s = new OmtSender()
    s.start({ targets: [target], fps: 30, width: 4, height: 2 })
    s.frame(frame())
    vi.advanceTimersByTime(100)
    expect(fake.frames).toHaveLength(3)
    expect(fake.frames[0]).toEqual({ width: 4, height: 2, fps: 30 })
  })

  it('reports the library-missing copy on a load error', () => {
    const { reports, target } = setup(() => {
      throw new OmtLoadError('nope')
    })
    new OmtSender().start({ targets: [target], fps: 30, width: 4, height: 2 })
    expect(reports.at(-1)).toMatchObject({ state: 'error', message: LOAD_MSG })
  })

  it('reports the create copy when create throws', () => {
    const { reports, target } = setup(() => new FakeSenderBinding('omt', { failCreate: true }))
    new OmtSender().start({ targets: [target], fps: 30, width: 4, height: 2 })
    expect(reports.at(-1)).toMatchObject({ state: 'error', message: CREATE_MSG })
  })

  it('reports the create copy when create returns 0', () => {
    const fake = new FakeSenderBinding('omt')
    fake.create = () => 0
    const { reports, target } = setup(() => fake)
    new OmtSender().start({ targets: [target], fps: 30, width: 4, height: 2 })
    expect(reports.at(-1)).toMatchObject({ state: 'error', message: CREATE_MSG })
  })

  it('stops the clock before destroy and sends nothing after destroy', () => {
    const fake = new FakeSenderBinding('omt')
    const order: string[] = []
    const send = fake.sendVideo.bind(fake)
    fake.sendVideo = (h, f) => {
      order.push(fake.destroyed ? 'send-after-destroy' : 'send')
      send(h, f)
    }
    const destroy = fake.destroy.bind(fake)
    fake.destroy = (h) => {
      order.push(vi.getTimerCount() === 0 ? 'destroy-clock-stopped' : 'destroy-clock-running')
      destroy(h)
    }
    const { target } = setup(() => fake)
    const s = new OmtSender()
    s.start({ targets: [target], fps: 30, width: 4, height: 2 })
    s.frame(frame())
    vi.advanceTimersByTime(40)
    s.stop()
    vi.advanceTimersByTime(500)
    s.frame(frame())
    s.audio(new Float32Array(4), 2)
    expect(order).toEqual(['send', 'destroy-clock-stopped'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('warns about drops at 60 fps above 10 % over 10 s', () => {
    const fake = new FakeSenderBinding('omt')
    const { reports, target } = setup(() => fake)
    const s = new OmtSender()
    s.start({ targets: [target], fps: 60, width: 4, height: 2 })
    for (let sec = 0; sec < 10; sec++) {
      for (let i = 0; i < 60; i++) {
        s.frame(frame())
        if (i < 8) s.frame(frame()) // replaces an unsent frame: one drop
        vi.advanceTimersByTime(1000 / 60)
      }
    }
    expect(reports.some((r) => r.warning === 'drops')).toBe(true)
  })

  it('never reports a drops warning for an ndi target', () => {
    const fake = new FakeSenderBinding('ndi')
    const { reports, target } = setup(() => fake, 'ndi')
    const s = new OmtSender()
    s.start({ targets: [target], fps: 60, width: 4, height: 2 })
    for (let i = 0; i < 600; i++) {
      s.frame(frame())
      s.frame(frame())
      vi.advanceTimersByTime(1000 / 60)
    }
    expect(reports.some((r) => r.warning === 'drops')).toBe(false)
  })

  it('a restart builds a new clock: the old last frame is not resent', () => {
    const fake = new FakeSenderBinding('omt')
    const { target } = setup(() => fake)
    const s = new OmtSender()
    s.start({ targets: [target], fps: 30, width: 4, height: 2 })
    s.frame(frame())
    vi.advanceTimersByTime(100)
    expect(fake.frames).toHaveLength(3)
    s.stop()
    s.start({ targets: [target], fps: 30, width: 4, height: 2 })
    vi.advanceTimersByTime(200)
    expect(fake.frames).toHaveLength(3)
    s.frame(frame())
    vi.advanceTimersByTime(34)
    expect(fake.frames).toHaveLength(4)
  })
})

describe('worker import graph', () => {
  it('has no electron import in the files the worker loads', () => {
    for (const f of ['worker', 'sender', 'binding', 'frame-clock']) {
      const src = readFileSync(new URL(`./${f}.ts`, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/from\s+['"]electron['"]/)
      expect(src, f).not.toMatch(/require\(\s*['"]electron['"]/)
    }
    const fake = readFileSync(new URL('../net/fake-binding.ts', import.meta.url), 'utf8')
    expect(fake).not.toMatch(/['"]electron['"]/)
  })

  it('imports sender and binding without touching electron', async () => {
    vi.resetModules()
    vi.doMock('electron', () => {
      throw new Error('electron must not load in the worker graph')
    })
    await expect(import('./sender')).resolves.toBeDefined()
    await expect(import('./binding')).resolves.toBeDefined()
    vi.doUnmock('electron')
  })
})
