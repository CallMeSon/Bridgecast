import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PPTX_RE } from '../library'
import { NO_SLIDES_MESSAGE, num, padded, type ImportedDeck } from './types'

interface Manifest {
  width: number
  height: number
  notes: string[]
  clicks: number[]
  hidden: boolean[]
  isStatic: boolean
  pdf: string
}

/** Reads the script's JSON line; arrays are padded or cut to `slideCount`, bad values become 0 / false. */
export function parseExportManifest(json: string, slideCount: number): Manifest {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('The PowerPoint import result could not be read. Try again.')
  }
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    width: num(o.width),
    height: num(o.height),
    notes: padded<string>(Array.isArray(o.notes) ? o.notes : [o.notes], slideCount, '', (x) =>
      typeof x === 'string' ? x : ''
    ),
    clicks: padded(o.clicks, slideCount, 0, num),
    hidden: padded(o.hidden, slideCount, false, (x) => x === true),
    isStatic: o.isStatic === true,
    pdf: typeof o.pdf === 'string' ? o.pdf : ''
  }
}

const TIMEOUT_MS = 5 * 60 * 1000

export function orderExportedFiles(names: string[]): string[] {
  const num = (n: string): number => Number(/(\d+)(?!.*\d)/.exec(n)?.[1] ?? 0)
  return names
    .filter((n) => /\.png$/i.test(n))
    .sort((a, b) => num(a) - num(b) || a.localeCompare(b))
}

function scriptPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../scripts/export-pptx.ps1'),
    path.resolve(__dirname, '../../../scripts/export-pptx.ps1'),
    path.resolve(process.cwd(), 'scripts/export-pptx.ps1')
  ]
  // In a packaged app the script is shipped outside asar (extraResources).
  const res = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (res) candidates.unshift(path.join(res, 'scripts', 'export-pptx.ps1'))
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[candidates.length - 1]
}

export function friendlyError(stderr: string): string {
  const code = /^(NOTFOUND|NOAPP|OPEN|EXPORT|INUSE|PASSWORD):/m.exec(stderr)?.[1]
  const lower = stderr.toLowerCase()
  if (code === 'NOTFOUND') return 'File not found. Check the file location, then choose it again.'
  if (code === 'NOAPP')
    return 'PowerPoint was not found on this computer. Install Microsoft PowerPoint, or export the file to PDF and import the PDF.'
  if (code === 'PASSWORD')
    return 'This presentation has a password. Remove it in PowerPoint, then import again.'
  if (code === 'OPEN') {
    if (/password|kata sandi|protected|dilindungi/.test(lower))
      return 'This file is password protected. Remove the password in PowerPoint, save, then import again.'
    return 'Could not open the file. Close it in PowerPoint, then try again. If the file is damaged, open and save it again in PowerPoint.'
  }
  if (code === 'INUSE')
    return 'This file is open in PowerPoint. Save and close it there, then import again.'
  if (code === 'EXPORT')
    return 'PowerPoint could not export the slides. Make sure the file is not damaged and there is enough disk space, then try again.'
  return 'PowerPoint import failed. Close the file in PowerPoint, then try again.'
}

function runScript(file: string, outDir: string, width: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath(),
        '-Path',
        file,
        '-OutDir',
        outDir,
        '-Width',
        String(width)
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          if (e.killed)
            return reject(
              new Error(
                'The import took too long (over 5 minutes). Close any dialog open in PowerPoint, then try again.'
              )
            )
          if (e.code === 'ENOENT')
            return reject(
              new Error('PowerShell was not found. PowerPoint import is supported on Windows only.')
            )
          return reject(new Error(friendlyError(String(stderr))))
        }
        resolve(String(stdout))
      }
    )
  })
}

/** PowerPoint import (Windows): `scripts/export-pptx.ps1` through PowerPoint COM. */
export async function importPptxPowerPoint(
  filePath: string,
  outDir: string,
  width: number
): Promise<ImportedDeck> {
  fs.mkdirSync(outDir, { recursive: true })
  const stdout = await runScript(filePath, outDir, width)
  const work = path.join(outDir, '_export')
  try {
    const line = stdout
      .replace(new RegExp('^' + String.fromCharCode(0xfeff)), '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop()
    const names = orderExportedFiles(fs.readdirSync(work))
    if (names.length === 0) throw new Error(NO_SLIDES_MESSAGE)
    const parsed = parseExportManifest(line ?? '', names.length)
    const notes = parsed.notes
    const slides = names.map((n, i) => {
      const pngPath = path.join(outDir, String(i + 1).padStart(3, '0') + '.png')
      fs.renameSync(path.join(work, n), pngPath)
      return { pngPath, notes: notes[i], clicks: parsed.clicks[i], hidden: parsed.hidden[i] }
    })
    return {
      name: path.basename(filePath).replace(PPTX_RE, ''),
      width: parsed.width,
      height: parsed.height,
      slides,
      pdfPath: parsed.pdf,
      isStatic: parsed.isStatic,
      sourcePath: filePath
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
