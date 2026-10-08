import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type ImportedDeck = {
  name: string
  width: number
  height: number
  slides: { pngPath: string; notes: string }[]
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

function friendlyError(stderr: string): string {
  const code = /^(NOTFOUND|NOAPP|OPEN|EXPORT|INUSE):/m.exec(stderr)?.[1]
  const lower = stderr.toLowerCase()
  if (code === 'NOTFOUND') return 'File not found. Check the file location, then choose it again.'
  if (code === 'NOAPP')
    return 'PowerPoint was not found on this computer. Install Microsoft PowerPoint, or export the file to PDF and import the PDF.'
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

export async function importPptx(
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
    let parsed: { width: number; height: number; notes: string[] | string }
    try {
      parsed = JSON.parse(line ?? '')
    } catch {
      throw new Error('The PowerPoint import result could not be read. Try again.')
    }
    const names = orderExportedFiles(fs.readdirSync(work))
    if (names.length === 0)
      throw new Error(
        'No slides were exported. Make sure the file contains slides, then try again.'
      )
    const notes = Array.isArray(parsed.notes) ? parsed.notes : [parsed.notes]
    const slides = names.map((n, i) => {
      const pngPath = path.join(outDir, String(i + 1).padStart(3, '0') + '.png')
      fs.renameSync(path.join(work, n), pngPath)
      return { pngPath, notes: notes[i] ?? '' }
    })
    return {
      name: path.basename(filePath).replace(/\.pptx?$/i, ''),
      width: parsed.width,
      height: parsed.height,
      slides
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}
