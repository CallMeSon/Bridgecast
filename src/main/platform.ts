import { execFile } from 'node:child_process'

/** Which program plays and imports PowerPoint files on this computer. */
export type EngineKind = 'powerpoint' | 'libreoffice' | 'none'

export const INSTALL_LIBREOFFICE =
  'Install LibreOffice Impress and python3-uno to import PowerPoint files, or export the file to PDF and import the PDF.'
export const WAYLAND_STILLS =
  "Animated slides need an X11 session on Linux. Log in with 'GNOME on Xorg' to play animations; showing still slides."
export const NO_POWERPOINT_ENGINE =
  'PowerPoint files can be imported on Windows and Linux only. Export the file to PDF and import the PDF.'

export interface PlatformProbe {
  platform: NodeJS.Platform
  /** `XDG_SESSION_TYPE`. */
  sessionType?: string
  hasSoffice: boolean
  hasPyUno: boolean
}

export interface EngineInfo {
  engine: EngineKind
  /** The slide show window can be captured (false on Wayland: native decks play as still images). */
  canCapture: boolean
  /** Operator copy: why PowerPoint import is refused (`none`) or why slides stay still (Wayland). */
  message?: string
}

/**
 * Engine choice is by platform only (no setting): Windows uses PowerPoint; Linux uses LibreOffice
 * Impress when `soffice` and python3-uno are there, and plays native decks as stills under Wayland.
 */
export function detectEngine(p: PlatformProbe): EngineInfo {
  if (p.platform === 'win32') return { engine: 'powerpoint', canCapture: true }
  if (p.platform === 'linux') {
    if (!p.hasSoffice || !p.hasPyUno) {
      return { engine: 'none', canCapture: false, message: INSTALL_LIBREOFFICE }
    }
    if (p.sessionType === 'wayland') {
      return { engine: 'libreoffice', canCapture: false, message: WAYLAND_STILLS }
    }
    return { engine: 'libreoffice', canCapture: true }
  }
  return { engine: 'none', canCapture: false, message: NO_POWERPOINT_ENGINE }
}

/** "PowerPoint" or "LibreOffice": the name used in Edit in ..., Resume ... and the fallback copy. */
export function engineName(kind: EngineKind): 'PowerPoint' | 'LibreOffice' {
  return kind === 'libreoffice' ? 'LibreOffice' : 'PowerPoint'
}

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: 15_000 }, (err) => resolve(!err))
    } catch {
      resolve(false)
    }
  })
}

/** `which soffice` and `python3 -c "import uno"`. Not unit tested (runs real programs). */
export async function probeLinux(): Promise<{ hasSoffice: boolean; hasPyUno: boolean }> {
  const [hasSoffice, hasPyUno] = await Promise.all([
    run('which', ['soffice']),
    run('python3', ['-c', 'import uno'])
  ])
  return { hasSoffice, hasPyUno }
}
