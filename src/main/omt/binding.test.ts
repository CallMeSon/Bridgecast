import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { OmtLoadError, loadLibomt } from './binding'
import { FakeSenderBinding } from '../net/fake-binding'

function fakeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omt-'))
  for (const f of ['libvmx.so', 'libvmx.dll', 'libvmx.dylib']) writeFileSync(join(dir, f), '')
  return dir
}

describe('loadLibomt', () => {
  it('throws OmtLoadError when the library is missing', () => {
    expect(() => loadLibomt('/nonexistent')).toThrow(OmtLoadError)
  })

  it('throws OmtLoadError when koffi itself fails to load', () => {
    const boom = (): never => {
      throw new Error('native module not found')
    }
    expect(() => loadLibomt(fakeDir(), boom)).toThrow(OmtLoadError)
  })

  it('rejects a video buffer shorter than width*4*height', () => {
    const koffi = {
      load: () => ({ func: () => () => ({}) }),
      struct: () => ({})
    }
    const b = loadLibomt(fakeDir(), () => koffi as never)
    const h = b.create('x')
    expect(() =>
      b.sendVideo(h, { width: 4, height: 2, fps: 30, data: new ArrayBuffer(31) })
    ).toThrow(/short/)
  })
})

describe('FakeSenderBinding', () => {
  it('records video (with fps), audio and destroy', () => {
    const b = new FakeSenderBinding('omt')
    const h = b.create('x')
    b.sendVideo(h, { width: 4, height: 2, fps: 30, data: new ArrayBuffer(32) })
    b.sendAudio(h, { sampleRate: 48000, channels: 2, samples: 1, data: new Float32Array(2) })
    expect(b.frames).toEqual([{ width: 4, height: 2, fps: 30 }])
    expect(b.audio).toBe(1)
    expect(b.address(h)).toBe('omt://fake')
    b.destroy(h)
    expect(b.destroyed).toBe(true)
  })

  it('ndi has no address; failCreate throws', () => {
    const b = new FakeSenderBinding('ndi')
    expect(b.address(b.create('x'))).toBe('')
    expect(() => new FakeSenderBinding('omt', { failCreate: true }).create('x')).toThrow()
  })
})
