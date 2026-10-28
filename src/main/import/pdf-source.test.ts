import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pdfSourceFields } from './pdf-source'

describe('pdfSourceFields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-src-'))
  const pdf = path.join(dir, 'a.pdf')
  fs.writeFileSync(pdf, 'x')
  it('uses an existing pdf file and plays it as vector', () => {
    expect(pdfSourceFields(pdf)).toEqual({ sourcePath: pdf, playback: 'vector' })
  })
  it('ignores missing, relative, non-pdf, directory and non-string paths', () => {
    fs.mkdirSync(path.join(dir, 'd.pdf'))
    for (const p of [
      path.join(dir, 'no.pdf'),
      'a.pdf',
      path.join(dir, 'a.txt'),
      path.join(dir, 'd.pdf'),
      undefined,
      5
    ])
      expect(pdfSourceFields(p)).toEqual({})
  })
})
