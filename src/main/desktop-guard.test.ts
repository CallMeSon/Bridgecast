import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { createDesktopGuard, guardSupported } from './desktop-guard'

// Real fs, with fsync observable and breakable.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) }
})
const { fsyncSync: realFsync } = await vi.importActual<typeof import('fs')>('fs')

const ORIGINALS: [string, string][] = [
  ['org.gnome.mutter overlay-key', "'Super_L'"],
  ['org.gnome.desktop.interface enable-hot-corners', 'true'],
  ['org.gnome.shell.keybindings toggle-application-view', "['<Super>a']"],
  ['org.gnome.shell.keybindings toggle-overview', "['<Super>s']"],
  ['org.gnome.shell.keybindings shift-overview-up', "['<Super><Alt>Up']"],
  ['org.gnome.shell.keybindings shift-overview-down', "['<Super><Alt>Down']"],
  ['org.gnome.desktop.wm.keybindings show-desktop', "['<Super>d']"],
  ['org.gnome.mutter.keybindings switch-monitor', "['<Super>p', 'XF86Display']"]
]

const OFF: Record<string, string> = {
  'org.gnome.mutter overlay-key': "''",
  'org.gnome.desktop.interface enable-hot-corners': 'false',
  'org.gnome.shell.keybindings toggle-application-view': '@as []',
  'org.gnome.shell.keybindings toggle-overview': '@as []',
  'org.gnome.shell.keybindings shift-overview-up': '@as []',
  'org.gnome.shell.keybindings shift-overview-down': '@as []',
  'org.gnome.desktop.wm.keybindings show-desktop': '@as []',
  'org.gnome.mutter.keybindings switch-monitor': '@as []'
}

const SUPER = 'org.gnome.mutter overlay-key'
const CORNERS = 'org.gnome.desktop.interface enable-hot-corners'
const OVERVIEW = 'org.gnome.shell.keybindings toggle-overview'

let dir: string
let file: string
let values: Map<string, string>
/** Throws from here to make one gsettings call fail. */
let fail: (op: string, key: string) => void
let onSet: () => void

const gsettings = vi.fn((args: string[]): string => {
  const [op, schema, name, value] = args
  const key = `${schema} ${name}`
  fail(op, key)
  const current = values.get(key)
  if (current === undefined) throw new Error(`No such key ${key}`)
  if (op === 'get') return current
  onSet()
  values.set(key, value)
  return ''
})
const blocker = { start: vi.fn(() => 7), stop: vi.fn<(id: number) => void>() }
const log = vi.fn()

const makeGuard = (path = file): ReturnType<typeof createDesktopGuard> =>
  createDesktopGuard({ file: path, gsettings, blocker, log })
const journal = (): Record<string, string> => JSON.parse(fs.readFileSync(file, 'utf8'))
const setCalls = (): string[][] =>
  gsettings.mock.calls.map((c) => c[0]).filter((a) => a[0] === 'set')

beforeEach(() => {
  vi.clearAllMocks()
  dir = fs.mkdtempSync(join(os.tmpdir(), 'ppt-guard-'))
  file = join(dir, 'desktop-guard.json')
  values = new Map(ORIGINALS)
  fail = () => {}
  onSet = () => {}
  vi.mocked(fs.fsyncSync).mockImplementation(realFsync)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('guardSupported', () => {
  it('supported on GNOME Linux only', () => {
    expect(guardSupported('linux', { XDG_CURRENT_DESKTOP: 'zorin:GNOME' })).toBe(true)
    expect(guardSupported('linux', { XDG_CURRENT_DESKTOP: 'KDE' })).toBe(false)
    expect(guardSupported('linux', {})).toBe(false)
    expect(guardSupported('win32', { XDG_CURRENT_DESKTOP: 'GNOME' })).toBe(false)
  })
})

describe('createDesktopGuard', () => {
  it('turns triggers off and puts them back', () => {
    const guard = makeGuard()
    guard.setActive(true)
    expect(values.get(SUPER)).toBe("''")
    expect(values.get(CORNERS)).toBe('false')
    expect(Object.fromEntries(values)).toEqual(OFF)
    expect(blocker.start).toHaveBeenCalledTimes(1)

    guard.setActive(false)
    expect([...values]).toEqual(ORIGINALS)
    expect(blocker.stop).toHaveBeenCalledWith(7)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('journal is written before the first set', () => {
    let seen: string | undefined
    onSet = () => {
      seen ??= journal()[SUPER]
    }
    makeGuard().setActive(true)
    expect(seen).toBe("'Super_L'")
  })

  it('second activation keeps the true originals', () => {
    makeGuard().setActive(true)
    values.set(SUPER, "'Super_R'")
    const next = makeGuard()
    next.setActive(true)
    expect(journal()).toEqual(Object.fromEntries(ORIGINALS))
    next.restore()
    expect(values.get(SUPER)).toBe("'Super_L'")
  })

  it('restart after a crash restores', () => {
    makeGuard().setActive(true)
    makeGuard().restore()
    expect([...values]).toEqual(ORIGINALS)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('keeps a value the user changed while active', () => {
    const guard = makeGuard()
    guard.setActive(true)
    values.set(SUPER, "'Super_R'")
    guard.setActive(false)
    expect(values.get(SUPER)).toBe("'Super_R'")
    expect(fs.existsSync(file)).toBe(false)
  })

  it('skips a missing key', () => {
    fail = (op, key) => {
      if (op === 'get' && key === OVERVIEW) throw new Error('No such key')
    }
    expect(() => makeGuard().setActive(true)).not.toThrow()
    expect(Object.fromEntries(values)).toEqual({ ...OFF, [OVERVIEW]: "['<Super>s']" })
    expect(journal()).not.toHaveProperty([OVERVIEW])
  })

  it('keeps the original when a restore fails', () => {
    const guard = makeGuard()
    guard.setActive(true)
    fail = (op, key) => {
      if (op === 'set' && key === SUPER) throw new Error('dconf is busy')
    }
    expect(() => guard.setActive(false)).not.toThrow()
    expect(journal()).toEqual({ [SUPER]: "'Super_L'" })
    expect(log).toHaveBeenCalled()

    fail = () => {}
    guard.restore()
    expect([...values]).toEqual(ORIGINALS)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('keeps the original when a restore silently does nothing', () => {
    const guard = makeGuard()
    guard.setActive(true)
    gsettings.mockImplementationOnce(() => "''") // get: still off
    gsettings.mockImplementationOnce(() => '') // set: no error, no change
    guard.setActive(false)
    expect(values.get(SUPER)).toBe("''")
    expect(journal()).toEqual({ [SUPER]: "'Super_L'" })
    expect(log).toHaveBeenCalled()

    guard.restore()
    expect([...values]).toEqual(ORIGINALS)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('syncs the journal and its directory before the first set', () => {
    let synced = 0
    onSet = () => {
      synced ||= vi.mocked(fs.fsyncSync).mock.calls.length
    }
    makeGuard().setActive(true)
    expect(synced).toBe(2)
  })

  it('changes nothing when the journal cannot be synced', () => {
    vi.mocked(fs.fsyncSync).mockImplementation(() => {
      throw new Error('EIO')
    })
    expect(() => makeGuard().setActive(true)).not.toThrow()
    expect(setCalls()).toEqual([])
    expect(fs.existsSync(file)).toBe(false)
    expect(log).toHaveBeenCalled()
  })

  it('still writes the journal when the directory cannot be synced', () => {
    vi.mocked(fs.fsyncSync).mockImplementation((fd) => {
      if (fs.fstatSync(fd).isDirectory()) throw new Error('EINVAL')
      realFsync(fd)
    })
    makeGuard().setActive(true)
    expect(journal()).toEqual(Object.fromEntries(ORIGINALS))
    expect(Object.fromEntries(values)).toEqual(OFF)
  })

  it('ignores a damaged journal', () => {
    fs.writeFileSync(file, '{not json')
    expect(() => makeGuard().restore()).not.toThrow()
    expect(fs.existsSync(file)).toBe(false)
    expect(setCalls()).toEqual([])
  })

  it('changes nothing when the journal cannot be written', () => {
    const guard = makeGuard(join(dir, 'missing', 'desktop-guard.json'))
    expect(() => guard.setActive(true)).not.toThrow()
    expect(setCalls()).toEqual([])
    expect(log).toHaveBeenCalled()
  })

  it('repeated calls are idempotent', () => {
    const guard = makeGuard()
    guard.setActive(true)
    guard.setActive(true)
    expect(blocker.start).toHaveBeenCalledTimes(1)
    guard.setActive(false)
    guard.setActive(false)
    expect(blocker.stop).toHaveBeenCalledTimes(1)
  })
})
