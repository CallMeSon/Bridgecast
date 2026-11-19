import * as fs from 'node:fs'
import path from 'node:path'
import { chromeSignInArgs, type LinuxBrowser } from './linux-browser'
import type { WebChromeStatus } from '../../shared/web'

/** Shown when the sign-in browser cannot start because this profile is in use. */
export const SIGN_IN_PROFILE_BUSY =
  'Chrome is already using the Bridgecast profile because web pages are open. Restart Bridgecast, then choose Sign in to Google before opening a web deck.'

/** Shown when Chrome for web pages is off or not usable, so there is nothing to sign in to. */
export const SIGN_IN_NOT_AVAILABLE =
  'Turn on Use Chrome for web pages first. Sign in to Google needs Google Chrome on this PC.'

/** Shown when a sign-in window is already open. */
export const SIGN_IN_ALREADY_OPEN =
  'The Google sign-in window is already open. Close it when you are done.'

/** The part of a spawned process the sign-in needs. */
export interface SignInChild {
  on(ev: 'exit' | 'error', cb: () => void): void
}

export interface SignInDeps {
  spawn(file: string, args: string[], env: NodeJS.ProcessEnv): SignInChild
  mkdir(dir: string): void
  /** Whether a running browser holds this profile folder. */
  inUse(dir: string): boolean
  env: NodeJS.ProcessEnv
}

/**
 * Whether a Chrome process holds `dir`: Chrome keeps a `SingletonLock` symlink named
 * `<host>-<pid>` in its profile folder, and the lock counts only while that process lives.
 */
export function profileInUse(
  dir: string,
  io: {
    readlink: (file: string) => string
    alive: (pid: number) => boolean
  } = {
    readlink: (f) => fs.readlinkSync(f),
    alive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM'
      }
    }
  }
): boolean {
  let target: string
  try {
    target = io.readlink(path.join(dir, 'SingletonLock'))
  } catch {
    return false
  }
  const pid = Number(/-(\d+)$/.exec(target)?.[1])
  return Number.isInteger(pid) && pid > 0 && io.alive(pid)
}

/** The environment of the sign-in browser: no Electron leftovers (it is not run as Node). */
export function signInEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env }
  delete out['ELECTRON_RUN_AS_NODE']
  // Electron's desktop name would make Chrome call its window "Electron".
  delete out['CHROME_DESKTOP']
  return out
}

/**
 * "Sign in to Google": a real Chrome window on the Bridgecast profile, with no automation. Google
 * refuses a sign-in while DevTools is attached, so the helper (which uses DevTools) only runs
 * later, on the profile this window leaves behind. One window at a time.
 */
export class GoogleSignIn {
  private running = false

  constructor(
    private deps: SignInDeps,
    private onChange: () => void
  ) {}

  get open(): boolean {
    return this.running
  }

  /** Opens the window; throws a sentence with the fix when it cannot. */
  start(browser: LinuxBrowser, profileDir: string): void {
    if (this.running) throw new Error(SIGN_IN_ALREADY_OPEN)
    if (this.deps.inUse(profileDir)) throw new Error(SIGN_IN_PROFILE_BUSY)
    this.deps.mkdir(profileDir)
    let child: SignInChild
    try {
      child = this.deps.spawn(browser.path, chromeSignInArgs(profileDir), signInEnv(this.deps.env))
    } catch {
      throw new Error('Chrome could not be started. Check that it still opens, then try again.')
    }
    this.running = true
    const done = (): void => {
      if (!this.running) return
      this.running = false
      this.onChange()
    }
    child.on('exit', done)
    child.on('error', done)
  }
}

export interface ChromeStatusInput {
  platform: NodeJS.Platform
  enabled: boolean
  browser: LinuxBrowser | null
  problem: string | null
  /** This session's web pages run in Chrome. */
  active: boolean
  signInOpen: boolean
}

/** What Settings shows for Chrome web pages. */
export function chromeStatus(i: ChromeStatusInput): WebChromeStatus {
  return {
    supported: i.platform === 'linux',
    enabled: i.enabled,
    browser: i.browser ? path.basename(i.browser.path) : null,
    problem: i.problem,
    active: i.active,
    // A restart cannot fix a PC that has no usable Chrome: nothing to announce then.
    restartNeeded: i.enabled !== i.active && !(i.enabled && i.problem),
    signInOpen: i.signInOpen
  }
}

/** Why "Sign in to Google" cannot start now, or null: on, supported, and a usable Chrome. */
export function signInRefusal(s: WebChromeStatus): string | null {
  if (!s.supported || !s.enabled || s.problem || !s.browser)
    return s.problem ?? SIGN_IN_NOT_AVAILABLE
  return null
}
