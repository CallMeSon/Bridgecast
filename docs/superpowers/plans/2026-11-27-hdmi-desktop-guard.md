# HDMI Desktop Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the HDMI output is showing on Linux GNOME, Super and similar triggers cannot change what that screen shows.

**Architecture:** One main-process module turns the GNOME triggers off with `gsettings` and holds a display-sleep blocker, journalling the originals to disk so they survive a crash. `index.ts` drives it from the HDMI status.

**Tech Stack:** Electron (`powerSaveBlocker`; check Context7 first), Node `child_process.execFileSync`, Vitest (node environment).

**Spec:** docs/superpowers/specs/2026-11-27-hdmi-desktop-guard-design.md

## Global Constraints

- Linux with `XDG_CURRENT_DESKTOP` containing `GNOME` only (this PC reports `zorin:GNOME`). No UI, no toggle.
- Active only while HDMI status is `showing`.
- Originals are written to `<userData>/desktop-guard.json` before any setting changes; an original is never overwritten by an off value.
- A `gsettings` failure is logged and never blocks the output or the quit.
- With `PPT_SHARE_USER_DATA` or `PPT_OUTPUT_DUMP` set, the real desktop settings are never touched.
- Prettier style; no new lint errors. Commits use `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com"`.

## Review Focus

- Crash or power loss while active: next start restores the true originals, also after a second activation.
- The operator changes a guarded setting during the show: their value is kept.
- A key or schema missing on this GNOME version: skipped, the rest still guarded.
- A restore that fails: its original stays in the journal for the next try.
- A damaged journal file: ignored and removed, the app still starts.

---

### Task 1: Guard module

**Files:**
- Create: `src/main/desktop-guard.ts`
- Test: `src/main/desktop-guard.test.ts`

**Interfaces (Produces):**

```ts
export function guardSupported(platform: NodeJS.Platform, env: Record<string, string | undefined>): boolean
export interface DesktopGuardDeps {
  file: string                               // journal path
  gsettings: (args: string[]) => string      // trimmed stdout; throws on failure
  blocker: { start: () => number; stop: (id: number) => void }
  log: (message: string, err?: unknown) => void
}
export interface DesktopGuard {
  setActive(on: boolean): void               // idempotent, synchronous, never throws
  restore(): void                            // restores from the journal, if any
}
export function createDesktopGuard(deps: DesktopGuardDeps): DesktopGuard
```

Guarded `[schema, key, offValue]` (values are GVariant text, as `gsettings get` prints them):

| schema | key | off |
|---|---|---|
| org.gnome.mutter | overlay-key | `''` |
| org.gnome.desktop.interface | enable-hot-corners | `false` |
| org.gnome.shell.keybindings | toggle-application-view | `@as []` |
| org.gnome.shell.keybindings | toggle-overview | `@as []` |
| org.gnome.shell.keybindings | shift-overview-up | `@as []` |
| org.gnome.shell.keybindings | shift-overview-down | `@as []` |
| org.gnome.desktop.wm.keybindings | show-desktop | `@as []` |
| org.gnome.mutter.keybindings | switch-monitor | `@as []` |

Journal: JSON object `{ "<schema> <key>": "<original text>" }`.

- Activate: `get` each key (skip on throw); skip a key already at its off value; merge into the existing journal **without replacing existing entries**; write the file; only then `set`. If the write throws, set nothing. Start the blocker (independent of gsettings results).
- Restore: for each journal entry, `get`; if it equals the off value, `set` the original; if it differs, leave it. Drop handled entries; keep entries whose `get`/`set` threw; delete the file when empty. `setActive(false)` also stops the blocker.

- [ ] **Step 1: Write the failing tests**, using a fake `gsettings` backed by a `Map` and a temp-dir journal:

| test name | assertions |
|---|---|
| `supported on GNOME Linux only` | true for `('linux', {XDG_CURRENT_DESKTOP:'zorin:GNOME'})`; false for `KDE`, for unset, and for `win32` with GNOME |
| `turns triggers off and puts them back` | after `setActive(true)` overlay-key is `''`, hot corners `false`, blocker started once; after `setActive(false)` every value equals its original, blocker stopped, journal file gone |
| `journal is written before the first set` | the journal exists and holds `'Super_L'` inside the first `set` call |
| `second activation keeps the true originals` | `setActive(true)`, new guard instance on same file, `setActive(true)`, `restore()` → overlay-key `'Super_L'` |
| `restart after a crash restores` | `setActive(true)`, new instance, `restore()` → originals back, file gone |
| `keeps a value the user changed while active` | set overlay-key to `'Super_R'` while active → still `'Super_R'` after `setActive(false)` |
| `skips a missing key` | `get` throws for `toggle-overview` → others are off, no throw |
| `keeps the original when a restore fails` | `set` throws for overlay-key on restore → file still holds `'Super_L'`; a later `restore()` succeeds and removes it |
| `ignores a damaged journal` | file content `{not json` → `restore()` does not throw, file removed |
| `changes nothing when the journal cannot be written` | `file` inside a missing directory → no `set` calls |
| `repeated calls are idempotent` | `setActive(true)` twice starts one blocker; `setActive(false)` twice stops it once |

- [ ] **Step 2:** `npx vitest run src/main/desktop-guard.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the interface above.
- [ ] **Step 4:** Same command → all PASS.
- [ ] **Step 5:** Commit `feat(linux): desktop guard for the HDMI output`.

### Task 2: Wiring and docs

**Files:**
- Modify: `src/main/index.ts` (`createHdmiOutput` ~line 1505, `whenReady` ~line 1833, `before-quit` ~line 2088)
- Modify: `PRODUCT.md`, `docs/test-checklist.md`, `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces (Consumes):** everything in Task 1.

- [ ] **Step 1:** Build the guard once in `whenReady` only if `guardSupported(process.platform, process.env)` and neither `PPT_SHARE_USER_DATA` nor `PPT_OUTPUT_DUMP` is set. `file` = `join(root, 'desktop-guard.json')`; `gsettings` = `execFileSync('gsettings', args, { encoding: 'utf8', timeout: 2000, env: childEnv(process.env) }).trim()`; `blocker` = `powerSaveBlocker` with `'prevent-display-sleep'`.
- [ ] **Step 2:** Call `restore()` right after building it, before `hdmi.start()`. In the HDMI status callback call `setActive(s.state === 'showing')` (pass the guard into `createHdmiOutput`). In `before-quit`, after `hdmi.shutdown()`, call `setActive(false)`.
- [ ] **Step 3:** Docs. `PRODUCT.md`: the spec's behavior and the three-finger-gesture limit. `CHANGELOG.md` under `### Fixed`: "Linux (GNOME): pressing Super no longer opens Activities over the HDMI output. While HDMI shows, Super, hot corners, show desktop and Super+P are off and the screen does not sleep; your settings come back afterwards." Checklist section "Penjaga desktop HDMI (Linux)": with a real second display, check Super, Super+A, Super+D, Super+P, hot corner; then HDMI off, unplug, quit, and `kill -9` + reopen, each time confirming `gsettings get org.gnome.mutter overlay-key` is `'Super_L'`; also from the AppImage and the `.deb`; note whether the three-finger swipe still opens Activities.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run lint` → typecheck and tests pass; lint shows only the 8 known errors. `npm run test:e2e` → passes, and `gsettings get org.gnome.mutter overlay-key` still prints `'Super_L'`.
- [ ] **Step 5:** Commit `feat(linux): guard the desktop while HDMI shows`.
