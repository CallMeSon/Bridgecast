import { execFile } from 'node:child_process'

import { engineName, type EngineKind } from '../shared/playback'

export { engineName }
export type { EngineKind }

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

/**
 * Linux in a Wayland session: the app must run on X11 (Xwayland). A Wayland compositor draws
 * only mapped windows, so the hidden web deck page window never gets a frame to capture, and a
 * window cannot be placed off-screen to hide it. On X11 the hidden window paints. The platform
 * is chosen before any script runs, so this takes a restart with `--ozone-platform=x11`.
 * Not when the flag is already given, and not without an X server to fall back on (DISPLAY).
 */
export function needsX11Relaunch(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  argv: readonly string[]
): boolean {
  if (platform !== 'linux') return false
  if (argv.some((a) => a.startsWith('--ozone-platform'))) return false
  const wayland = env['XDG_SESSION_TYPE'] === 'wayland' || !!env['WAYLAND_DISPLAY']
  return wayland && !!env['DISPLAY']
}

/**
 * Options for `app.relaunch` that restart on X11. An AppImage runs from a temporary mount that
 * is gone once this process exits, so the default `process.execPath` would start nothing: it
 * restarts through the `.AppImage` file itself (`APPIMAGE`, set by the AppImage runtime).
 */
export function x11RelaunchOptions(
  env: Record<string, string | undefined>,
  argv: readonly string[]
): { execPath?: string; args: string[] } {
  const args = [...argv.slice(1), '--ozone-platform=x11']
  const appImage = env['APPIMAGE']
  return appImage ? { execPath: appImage, args } : { args }
}
