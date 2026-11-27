/**
 * Keeps GNOME from covering the HDMI output: while it shows, the shortcuts and
 * hot corner that act on every display are turned off through `gsettings`, and
 * the screen is kept awake. The originals are journalled to disk before anything
 * changes, so a crash can be undone at the next start.
 */
import * as fs from 'fs'

/** `[schema, key, off value]`; values are GVariant text, as `gsettings get` prints them. */
const GUARDED: readonly (readonly [string, string, string])[] = [
  ['org.gnome.mutter', 'overlay-key', "''"],
  ['org.gnome.desktop.interface', 'enable-hot-corners', 'false'],
  ['org.gnome.shell.keybindings', 'toggle-application-view', '@as []'],
  ['org.gnome.shell.keybindings', 'toggle-overview', '@as []'],
  ['org.gnome.shell.keybindings', 'shift-overview-up', '@as []'],
  ['org.gnome.shell.keybindings', 'shift-overview-down', '@as []'],
  ['org.gnome.desktop.wm.keybindings', 'show-desktop', '@as []'],
  ['org.gnome.mutter.keybindings', 'switch-monitor', '@as []']
]

/** Original values by `"<schema> <key>"`. */
type Journal = Record<string, string>

export function guardSupported(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>
): boolean {
  return platform === 'linux' && (env.XDG_CURRENT_DESKTOP ?? '').includes('GNOME')
}

export interface DesktopGuardDeps {
  /** Journal path. */
  file: string
  /** Trimmed stdout; throws on failure. */
  gsettings: (args: string[]) => string
  blocker: { start: () => number; stop: (id: number) => void }
  log: (message: string, err?: unknown) => void
}

export interface DesktopGuard {
  /** Idempotent, synchronous, never throws. */
  setActive(on: boolean): void
  /** Restores from the journal, if any. */
  restore(): void
}

export function createDesktopGuard({
  file,
  gsettings,
  blocker,
  log
}: DesktopGuardDeps): DesktopGuard {
  let active = false
  let blockerId: number | null = null

  const attempt = (message: string, run: () => void): void => {
    try {
      run()
    } catch (err) {
      log(message, err)
    }
  }

  /** Empty when there is no file or it is damaged; throws when it cannot be read. */
  const readJournal = (): Journal => {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
    try {
      return { ...(JSON.parse(text) as Journal) }
    } catch (err) {
      log(`${file} is damaged; ignoring it`, err)
      return {}
    }
  }

  /** Atomic, so a power cut cannot leave half a journal; removes an empty one. */
  const writeJournal = (journal: Journal): void => {
    if (Object.keys(journal).length === 0) {
      fs.rmSync(file, { force: true })
      return
    }
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  const turnOff = (): void => {
    const journal = readJournal()
    const pending: (readonly [string, string, string])[] = []
    for (const entry of GUARDED) {
      const [schema, key, off] = entry
      attempt(`could not read ${schema} ${key}`, () => {
        const current = gsettings(['get', schema, key])
        if (current === off) return
        // An entry already there is the true original; keep it.
        journal[`${schema} ${key}`] ??= current
        pending.push(entry)
      })
    }
    if (pending.length === 0) return
    writeJournal(journal)
    for (const [schema, key, off] of pending) {
      attempt(`could not turn off ${schema} ${key}`, () => {
        gsettings(['set', schema, key, off])
      })
    }
  }

  const putBack = (): void => {
    const journal = readJournal()
    const remaining: Journal = {}
    for (const [schema, key, off] of GUARDED) {
      const id = `${schema} ${key}`
      const original = journal[id]
      if (typeof original !== 'string') continue
      try {
        // Anything but the off value was changed by the user meanwhile: leave it.
        if (gsettings(['get', schema, key]) === off) gsettings(['set', schema, key, original])
      } catch (err) {
        remaining[id] = original
        log(`could not restore ${id}`, err)
      }
    }
    writeJournal(remaining)
  }

  const restore = (): void => attempt('could not restore the desktop settings', putBack)

  return {
    restore,
    setActive(on) {
      if (on) {
        if (active) return
        active = true
        attempt('could not turn off the desktop triggers', turnOff)
        attempt('could not keep the display awake', () => {
          blockerId = blocker.start()
        })
        return
      }
      active = false
      const id = blockerId
      blockerId = null
      if (id !== null) attempt('could not release the display', () => blocker.stop(id))
      // Also when not active: retries entries an earlier restore had to keep.
      restore()
    }
  }
}
