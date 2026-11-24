import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  convertPptxToPdf,
  CONVERT_FAILED,
  isAutomationDenied,
  keynoteArgs,
  KEYNOTE_APP,
  KEYNOTE_DENIED,
  NO_MAC_CONVERTER,
  sofficeArgs,
  SOFFICE_PATHS,
  type MacConvertDeps
} from './mac-convert'

const OUT = path.join('/tmp/o', 'Show.pdf')

function deps(o: {
  keynote?: boolean
  soffice?: boolean
  failKeynote?: string
  failSoffice?: boolean
  noOutput?: boolean
}): MacConvertDeps & { calls: string[] } {
  const made = new Set<string>()
  const calls: string[] = []
  return {
    calls,
    exists: (p) =>
      (p === KEYNOTE_APP && !!o.keynote) || (p === SOFFICE_PATHS[0] && !!o.soffice) || made.has(p),
    run: async (cmd) => {
      calls.push(cmd)
      if (cmd === 'osascript' && o.failKeynote) throw new Error(o.failKeynote)
      if (cmd !== 'osascript' && o.failSoffice) throw new Error('soffice failed')
      if (!o.noOutput) made.add(OUT)
    }
  }
}

describe('argv', () => {
  it('passes paths as argv after the script', () => {
    const a = keynoteArgs('/a b/x.pptx', '/o/x.pdf')
    expect(a.slice(0, 1)).toEqual(['-e'])
    expect(a.slice(2)).toEqual(['/a b/x.pptx', '/o/x.pdf'])
    expect(a[1]).not.toContain('/a b/')
    expect(sofficeArgs('/a.pptx', '/o')).toEqual([
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      '/o',
      '/a.pptx'
    ])
  })
  it('spots the Automation refusal', () => {
    expect(
      isAutomationDenied(new Error('execution error: Not authorized to send Apple events (-1743)'))
    ).toBe(true)
    expect(isAutomationDenied(new Error('boom'))).toBe(false)
  })
})

describe('convertPptxToPdf', () => {
  const go = (d: MacConvertDeps): Promise<string> => convertPptxToPdf('/in/Show.pptx', '/tmp/o', d)

  it('uses Keynote first', async () => {
    const d = deps({ keynote: true, soffice: true })
    expect(await go(d)).toBe(OUT)
    expect(d.calls).toEqual(['osascript'])
  })
  it('uses LibreOffice when Keynote is missing', async () => {
    const d = deps({ soffice: true })
    expect(await go(d)).toBe(OUT)
    expect(d.calls).toEqual([SOFFICE_PATHS[0]])
  })
  it('falls back to LibreOffice when Keynote fails', async () => {
    const d = deps({ keynote: true, soffice: true, failKeynote: 'x (-1743)' })
    expect(await go(d)).toBe(OUT)
    expect(d.calls).toEqual(['osascript', SOFFICE_PATHS[0]])
  })
  it('says nothing is installed', async () => {
    await expect(go(deps({}))).rejects.toThrow(NO_MAC_CONVERTER)
  })
  it('says to allow Automation when denied and no LibreOffice', async () => {
    await expect(
      go(deps({ keynote: true, failKeynote: 'Not authorized (-1743)' }))
    ).rejects.toThrow(KEYNOTE_DENIED)
  })
  it('reports a plain failure, also when no PDF appears', async () => {
    await expect(go(deps({ keynote: true, failKeynote: 'other' }))).rejects.toThrow(CONVERT_FAILED)
    await expect(go(deps({ soffice: true, noOutput: true }))).rejects.toThrow(CONVERT_FAILED)
  })
})
