import { describe, expect, it } from 'vitest'
import {
  GoogleSignIn,
  SIGN_IN_ALREADY_OPEN,
  SIGN_IN_NOT_AVAILABLE,
  SIGN_IN_PROFILE_BUSY,
  chromeStatus,
  profileInUse,
  signInEnv,
  signInRefusal,
  type SignInChild
} from './chrome-signin'

const chrome = { path: '/usr/bin/google-chrome-stable', snap: false }

describe('profileInUse', () => {
  it('is false without a lock, with a stale lock, true with a live one', () => {
    const none = {
      readlink: () => {
        throw new Error('ENOENT')
      },
      alive: () => true
    }
    expect(profileInUse('/p', none)).toBe(false)
    expect(profileInUse('/p', { readlink: () => 'host-4242', alive: () => false })).toBe(false)
    const seen: number[] = []
    expect(
      profileInUse('/p', {
        readlink: (f) => (f === '/p/SingletonLock' ? 'my-host-4242' : ''),
        alive: (pid) => (seen.push(pid), true)
      })
    ).toBe(true)
    expect(seen).toEqual([4242])
  })

  it('ignores a lock that does not name a pid', () => {
    expect(profileInUse('/p', { readlink: () => 'garbage', alive: () => true })).toBe(false)
  })
})

describe('signInEnv', () => {
  it('drops the Electron leftovers and keeps the rest', () => {
    const env = signInEnv({ ELECTRON_RUN_AS_NODE: '1', CHROME_DESKTOP: 'x', HOME: '/h' })
    expect(env).toEqual({ HOME: '/h' })
  })
})

function harness(inUse = false): {
  signIn: GoogleSignIn
  calls: { file: string; args: string[] }[]
  changes: number[]
  exit(): void
  dirs: string[]
} {
  const calls: { file: string; args: string[] }[] = []
  const dirs: string[] = []
  const changes: number[] = []
  let onExit: () => void = () => undefined
  const child: SignInChild = {
    on: (ev, cb) => {
      if (ev === 'exit') onExit = cb
    }
  }
  const signIn = new GoogleSignIn(
    {
      spawn: (file, args) => (calls.push({ file, args }), child),
      mkdir: (d) => void dirs.push(d),
      inUse: () => inUse,
      env: {}
    },
    () => void changes.push(1)
  )
  return { signIn, calls, changes, dirs, exit: () => onExit() }
}

describe('GoogleSignIn', () => {
  it('opens Chrome on the profile with no debugging port, and reports when it closes', () => {
    const h = harness()
    h.signIn.start(chrome, '/d/web-profile/default')
    expect(h.dirs).toEqual(['/d/web-profile/default'])
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]!.file).toBe(chrome.path)
    expect(h.calls[0]!.args.join(' ')).not.toMatch(/remote-debugging/)
    expect(h.signIn.open).toBe(true)
    h.exit()
    expect(h.signIn.open).toBe(false)
    expect(h.changes).toHaveLength(1)
  })

  it('refuses a second window and a profile that web pages hold', () => {
    const h = harness()
    h.signIn.start(chrome, '/p')
    expect(() => h.signIn.start(chrome, '/p')).toThrow(SIGN_IN_ALREADY_OPEN)
    expect(() => harness(true).signIn.start(chrome, '/p')).toThrow(SIGN_IN_PROFILE_BUSY)
  })

  it('can open again after it closed', () => {
    const h = harness()
    h.signIn.start(chrome, '/p')
    h.exit()
    h.signIn.start(chrome, '/p')
    expect(h.calls).toHaveLength(2)
  })

  it('turns a failed spawn into a sentence and stays closed', () => {
    const s = new GoogleSignIn(
      {
        spawn: () => {
          throw new Error('EACCES')
        },
        mkdir: () => undefined,
        inUse: () => false,
        env: {}
      },
      () => undefined
    )
    expect(() => s.start(chrome, '/p')).toThrow(/could not be started/)
    expect(s.open).toBe(false)
  })
})

describe('chromeStatus and signInRefusal', () => {
  const input = {
    platform: 'linux' as const,
    enabled: true,
    browser: chrome,
    problem: null,
    active: true,
    signInOpen: false
  }

  it('reports a restart only when the setting differs from the session', () => {
    expect(chromeStatus(input).restartNeeded).toBe(false)
    expect(chromeStatus({ ...input, active: false }).restartNeeded).toBe(true)
    expect(chromeStatus({ ...input, enabled: false }).restartNeeded).toBe(true)
  })

  it('does not ask for a restart when Chrome cannot be used anyway', () => {
    const s = chromeStatus({ ...input, browser: null, problem: 'No Chrome.', active: false })
    expect(s.restartNeeded).toBe(false)
    expect(signInRefusal(s)).toBe('No Chrome.')
  })

  it('refuses sign-in while the setting is off, allows it when on and usable', () => {
    expect(signInRefusal(chromeStatus({ ...input, enabled: false }))).toBe(SIGN_IN_NOT_AVAILABLE)
    expect(signInRefusal(chromeStatus(input))).toBeNull()
    expect(chromeStatus(input).browser).toBe('google-chrome-stable')
  })

  it('is unsupported off Linux', () => {
    const s = chromeStatus({ ...input, platform: 'win32' })
    expect(s.supported).toBe(false)
    expect(signInRefusal(s)).not.toBeNull()
  })
})
