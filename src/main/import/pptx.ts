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
  if (code === 'NOTFOUND') return 'File tidak ditemukan. Periksa lokasi file lalu pilih ulang.'
  if (code === 'NOAPP')
    return 'PowerPoint tidak ditemukan di komputer ini. Pasang Microsoft PowerPoint, atau ekspor file ke PDF lalu impor PDF-nya.'
  if (code === 'OPEN') {
    if (/password|kata sandi|protected|dilindungi/.test(lower))
      return 'File dilindungi kata sandi. Hapus kata sandinya di PowerPoint, simpan, lalu impor ulang.'
    return 'Tidak bisa membuka file. Tutup file di PowerShell/PowerPoint lalu coba lagi. Jika file rusak, buka dan simpan ulang di PowerPoint.'
  }
  if (code === 'INUSE')
    return 'File ini sedang terbuka di PowerPoint. Simpan dan tutup file itu, lalu coba impor lagi.'
  if (code === 'EXPORT')
    return 'PowerPoint gagal mengekspor slide. Pastikan file tidak rusak dan ruang disk cukup, lalu coba lagi.'
  return 'Impor PowerPoint gagal. Tutup file di PowerPoint lalu coba lagi.'
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
                'Impor terlalu lama (lebih dari 5 menit). Tutup dialog di PowerPoint jika ada, lalu coba lagi.'
              )
            )
          if (e.code === 'ENOENT')
            return reject(
              new Error('PowerShell tidak ditemukan. Impor PowerPoint hanya didukung di Windows.')
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
      throw new Error('Hasil impor dari PowerPoint tidak terbaca. Coba lagi.')
    }
    const names = orderExportedFiles(fs.readdirSync(work))
    if (names.length === 0)
      throw new Error(
        'Tidak ada slide yang berhasil diekspor. Pastikan file berisi slide, lalu coba lagi.'
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
