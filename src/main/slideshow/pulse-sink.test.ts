import { describe, expect, it } from 'vitest'
import { PulseSink, parseSinks, SINK_NAME, SOURCE_NAME } from './pulse-sink'

const LIST =
  '142\talsa_output.pci-0000_00_1f.3.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED\n357\tpptshare_lo\tPipeWire\tfloat32le 2ch 48000Hz\tIDLE\n'

describe('parseSinks', () => {
  it('reads the names from `pactl list short`', () => {
    expect(parseSinks(LIST)).toEqual(['alsa_output.pci-0000_00_1f.3.analog-stereo', 'pptshare_lo'])
    expect(parseSinks('')).toEqual([])
  })
})

function fake(state: { sinks: string[]; sources: string[]; failLoad?: string }): {
  calls: string[][]
  exec: (a: string[]) => Promise<string>
} {
  const calls: string[][] = []
  let next = 100
  return {
    calls,
    exec: async (a) => {
      calls.push(a)
      if (a[0] === 'list' && a[2] === 'sinks')
        return state.sinks.map((n, i) => `${i}\t${n}\tx`).join('\n')
      if (a[0] === 'list' && a[2] === 'sources')
        return state.sources.map((n, i) => `${i}\t${n}\tx`).join('\n')
      if (a[0] === 'load-module') {
        if (state.failLoad && a[1] === state.failLoad) throw new Error('load failed')
        return `${next++}\n`
      }
      return ''
    }
  }
}

describe('PulseSink', () => {
  it('loads the sink and the capture source, and unloads only those on remove', async () => {
    const f = fake({ sinks: [], sources: [] })
    const s = new PulseSink(f.exec)
    expect(await s.ensure()).toBe(true)
    expect(f.calls.filter((c) => c[0] === 'load-module').map((c) => c[1])).toEqual([
      'module-null-sink',
      'module-remap-source'
    ])
    await s.remove()
    expect(f.calls.filter((c) => c[0] === 'unload-module')).toEqual([
      ['unload-module', '101'],
      ['unload-module', '100']
    ])
  })

  it('reuses an existing sink and source (left by a crashed run) and never unloads them', async () => {
    const f = fake({ sinks: [SINK_NAME], sources: [SOURCE_NAME] })
    const s = new PulseSink(f.exec)
    expect(await s.ensure()).toBe(true)
    expect(f.calls.some((c) => c[0] === 'load-module')).toBe(false)
    await s.remove()
    expect(f.calls.some((c) => c[0] === 'unload-module')).toBe(false)
  })

  it('returns false when pactl is missing (ENOENT), without throwing', async () => {
    const s = new PulseSink(async () => {
      throw Object.assign(new Error('spawn pactl ENOENT'), { code: 'ENOENT' })
    })
    expect(await s.ensure()).toBe(false)
  })

  it('returns false and unloads the sink it loaded when the capture source fails', async () => {
    const f = fake({ sinks: [], sources: [], failLoad: 'module-remap-source' })
    const s = new PulseSink(f.exec)
    expect(await s.ensure()).toBe(false)
    expect(f.calls.filter((c) => c[0] === 'unload-module')).toEqual([['unload-module', '100']])
  })
})
