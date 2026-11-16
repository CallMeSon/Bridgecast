# Auto-update (notify, download, install) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridgecast tells the operator when a newer stable release exists on GitHub, downloads it only when the operator agrees, and installs it only when nothing is on air. Releases are cut with one command.

**Architecture:** `electron-updater` (GitHub provider, NSIS) sits behind a small `UpdateEngine` interface so all decisions live in a pure, tested `UpdateManager` in `src/main/updater/`. Main owns the state and broadcasts an `UpdateStatus`; the renderer shows a header chip, a banner and a block in Settings > About. Modeled on `/home/econ/work/stagecast` (`UpdateService.cs`, `MainWindow.Update.cs`): check at start and every 6 h, silent on failure, chip + one banner per version, "skip this version", release notes shown as plain lines, nothing installed without an operator action, warning when the output is live.

**Tech Stack:** Electron, `electron-updater` (check docs with Context7 before using it), electron-builder `publish: github`, Vitest (node env, no jsdom), Playwright e2e.

**Spec:** none. The design is the "Auto-update" and UI item 1 sections of the 2026-11-16 conversation, restated in Architecture and Global Constraints above and below. Reference implementation: `/home/econ/work/stagecast/src/Stagecast.App/UpdateService.cs`, `MainWindow.Update.cs`, `UpdateDialogs.cs`, `src/Stagecast.Core/Updates/*`.

**Scope note:** UI items 2 to 5 (readiness card on Home, actionable error messages, shortcut hints, shortcuts sheet) are NOT in this plan. They are a separate plan once the user picks which to build. This plan changes UI only for the update chip, banner and About block.

## Global Constraints

- Branch `feat/user-ready-ui`. Commits: `git -c user.name="Gerson Sebastian" -c user.email="sebastiangerson24@gmail.com" commit ...`; stage only your own files.
- Windows (NSIS) and Linux AppImage update themselves: `app.isPackaged` and (`process.platform === 'win32'` or (`process.platform === 'linux'` and `process.env.APPIMAGE` is set)). A `.deb` install, macOS and dev builds never check and show no update UI except the version.
- Nothing downloads or installs by itself: `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowPrerelease = false`, `allowDowngrade = false`.
- A failed check (offline, rate limit, no `latest.yml`) is silent: status returns to `idle`, no toast, no log above info.
- Install is refused while anything is on air (`shown !== null` in `ProgramState`). Never black, never desktop: an update must not close an output that is showing.
- Do not touch the dark palette (CLAUDE.md "Dark palette is pinned"). Use existing tokens from `DESIGN.md`; load the `impeccable` skill for Task 4.
- UI copy is English. Update env switch: `BRIDGECAST_NO_UPDATE_CHECK=1`. Test flag: `PPT_UPDATE_FAKE=1` (fake engine, no network).
- Add IPC in order: `src/shared/ipc.ts`, then `src/main/index.ts`, then `src/preload/index.ts`.
- Do not add lint errors (`npm run lint` has 8 known). `npm run typecheck` and `npm test` stay green after every task.
- Versioning (user decision 2026-11-16): the app is still in development, so the version goes back to `0.x`. `package.json` becomes `0.1.0` (Task 5). Pre-release suffixes are not used. The existing `1.1.0` install base is the user's own machines; they reinstall once.
- Release tags are `vX.Y.Z`, one GitHub release per version, holding the Windows setup + `latest.yml` AND the Linux AppImage + `latest-linux.yml`. The old `vX.Y.Z-linux` tags stop (an updater reads the yml of the newest release; a release without its yml makes the check fail silently).
- Releases live in `CallMeSon/ppt-share`, which the user decided to make PUBLIC with `gh` (user decision 2026-11-16). The coordinator runs that command, not a worker (Task 5, Step 1). `publish` in `electron-builder.yml` is `provider: github, owner: CallMeSon, repo: ppt-share`.
- Windows-only behavior (real NSIS install, relaunch, OMT shutdown before install, NDI step) cannot be verified on this Linux machine. Write it into `docs/test-checklist.md` so the user's agent on the Windows PC can run it; never claim it verified.

## Review Focus

- Offline or GitHub rate-limited at start: no error UI, app starts at the normal speed, next check happens in 6 h. (Task 2 test)
- Update appears while a slide is live: banner may show, but "Restart and install" is disabled with the reason, and `install()` returns false. (Task 2 test, Task 6 e2e)
- Operator presses Space (Next) while the Download or Install button has focus: it must not trigger the button. The banner never takes focus by itself. (Task 4 test on the key guard, Task 6 e2e)
- Skipped version `1.2.0` stays hidden, `1.2.1` is announced again; a pre-release or an older version is never offered. (Task 1 and Task 2 tests)
- Download fails or hash does not match: status `error` with a short message and a "Try again" action; the running app and its output are untouched. (Task 2 test)

---

## File Structure

- Create `src/shared/update.ts`: `UpdateStatus`, `isNewerVersion`, `releaseNotesLines`, `canInstallNow`. Pure, shared by both processes.
- Create `src/shared/update.test.ts`.
- Modify `src/shared/settings.ts`: `Settings.updates: { skippedVersion: string | null }`, `sanitizeUpdates`.
- Create `src/main/updater/manager.ts` (+ `manager.test.ts`): `UpdateManager`, `UpdateEngine` interface.
- Create `src/main/updater/electron-engine.ts`: `createElectronEngine()` wrapping `electron-updater`.
- Create `src/main/updater/fake-engine.ts`: `createFakeEngine()` for `PPT_UPDATE_FAKE=1`.
- Modify `src/shared/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`: channels and wiring.
- Create `src/renderer/src/update-ui.ts` (+ `update-ui.test.ts`): view model for chip, banner and About block.
- Create `src/renderer/src/components/UpdateBanner.tsx`; modify `Header.tsx` (chip) and `SettingsDialog.tsx` (About block); styles in `src/renderer/src/styles/`.
- Modify `electron-builder.yml` (publish block), `package.json` (dependency, `release:win` script).
- Create `CHANGELOG.md`, `scripts/release.mjs`; modify `package.json` version to `0.1.0`.
- Create `e2e/update.mjs`; modify `package.json` (`test:e2e:update`, add to `test:e2e:all`).
- Modify `PRODUCT.md`, `docs/test-checklist.md`, `README.md` (release steps; Windows and Linux builds are published from their own machines to the same release).

---

### Task 1: Shared update model and settings field

**Files:**
- Create: `src/shared/update.ts`, `src/shared/update.test.ts`
- Modify: `src/shared/settings.ts` (interface at line 56, `sanitizeSettings` at line 142), `src/main/settings.ts` (`DEFAULT_SETTINGS` at line 18)
- Test: `src/shared/update.test.ts`, `src/main/settings.test.ts`

**Interfaces:**
- Produces (`src/shared/update.ts`):
  - `type UpdateStatus = { kind: 'idle' } | { kind: 'checking' } | { kind: 'available'; version: string; notes: string } | { kind: 'downloading'; version: string; percent: number } | { kind: 'ready'; version: string } | { kind: 'error'; version: string; message: string }`
  - `isNewerVersion(candidate: string, current: string): boolean` (semver: `1.2.0-beta.1` is older than `1.2.0`; an unparsable input gives false)
  - `releaseNotesLines(markdown: string): { kind: 'heading' | 'bullet' | 'paragraph'; text: string }[]` (same rules as Stagecast `ReleaseNotesText.cs`: `#` headings, `- `/`* ` bullets, indented lines continue the previous bullet, strip `**` and backticks, skip blanks)
  - `canInstallNow(state: ProgramState): boolean` (false when `state.shown !== null`)
  - `interface UpdateSettings { skippedVersion: string | null }`, `DEFAULT_UPDATES`, `sanitizeUpdates(raw: unknown): UpdateSettings`
- Produces (`settings.ts`): `Settings.updates: UpdateSettings`.

- [x] **Step 1: Write the failing tests** in `src/shared/update.test.ts`:
  - `isNewerVersion('1.2.0', '1.1.0')` true; `('1.1.0','1.1.0')` false; `('1.0.9','1.1.0')` false; `('1.2.0-beta.1','1.1.0')` true; `('1.2.0-beta.1','1.2.0')` false; `('1.2.0','1.2.0-beta.1')` true; `('v1.2.0','1.1.0')` true (leading `v` accepted); `('nope','1.1.0')` false.
  - `releaseNotesLines('### Added\n- **Fast** start\n  continued\n\nPlain')` equals `[{heading,'Added'},{bullet,'Fast start continued'},{paragraph,'Plain'}]`; `releaseNotesLines('')` equals `[]`.
  - `canInstallNow` true for `INITIAL_STATE`-like state with `shown: null`, false when `shown` is set (build the state from the reducer's initial state exported by `program.ts`).
  - `sanitizeUpdates(undefined)` equals `{ skippedVersion: null }`; `sanitizeUpdates({ skippedVersion: 5 })` equals `{ skippedVersion: null }`; `sanitizeUpdates({ skippedVersion: '1.2.0' })` keeps it.
  In `src/main/settings.test.ts` add: `sanitizeSettings({})` has `updates` equal to `{ skippedVersion: null }`.
- [x] **Step 2: Run** `npx vitest run src/shared/update.test.ts src/main/settings.test.ts`. Expected: FAIL (module / property missing).
- [x] **Step 3: Implement** `src/shared/update.ts` with the signatures above and add `updates` to `Settings`, `DEFAULT_SETTINGS` and `sanitizeSettings`. Write the version compare by hand (split on `-`, compare numeric parts, a pre-release is lower than the same release); no new dependency.
- [x] **Step 4: Run** the same command plus `npm run typecheck`. Expected: PASS, typecheck clean (fix any `Settings` literal elsewhere that now lacks `updates`).
- [x] **Step 5: Commit** `git add src/shared src/main/settings.ts src/main/settings.test.ts && git commit -m "feat(update): shared update status, version compare and settings field"` (with the identity from Global Constraints).

---

### Task 2: UpdateManager (all decisions, no Electron)

**Files:**
- Create: `src/main/updater/manager.ts`, `src/main/updater/manager.test.ts`

**Interfaces:**
- Consumes: `UpdateStatus`, `isNewerVersion`, `canInstallNow`-style boolean from Task 1.
- Produces (`manager.ts`):
  - `interface UpdateEngine { check(): Promise<{ version: string; notes: string } | null>; download(onProgress: (percent: number) => void): Promise<void>; quitAndInstall(): void }`
  - `interface UpdateManagerDeps { engine: UpdateEngine; currentVersion: string; getSkipped(): string | null; setSkipped(version: string | null): void; isOnAir(): boolean; onStatus(status: UpdateStatus): void }`
  - `class UpdateManager { constructor(deps: UpdateManagerDeps); get status(): UpdateStatus; check(): Promise<void>; download(): Promise<void>; install(): boolean; skip(): void }`

- [x] **Step 1: Write the failing tests** in `manager.test.ts` using a hand-written fake engine and a recording `onStatus`:
  - `check()` with engine returning `{version:'1.2.0'}` and current `1.1.0` → status `available` (statuses seen: `checking`, `available`).
  - `check()` when the engine throws → status `idle`, no `error` kind, no throw (offline is silent).
  - `check()` when engine returns a version equal to or older than current, or a pre-release while current is stable → `idle`.
  - `check()` when `getSkipped()` is `'1.2.0'` and engine returns `1.2.0` → `idle`; engine returns `1.2.1` → `available`.
  - `skip()` while `available` for `1.2.0` calls `setSkipped('1.2.0')` and goes to `idle`.
  - `download()` only works from `available`; progress `40` yields `{downloading, percent: 40}`; success → `ready`; engine rejects → `{error, version, message}` and a second `download()` retries from `error`.
  - `install()` returns false and does not call `quitAndInstall` when `isOnAir()` is true or status is not `ready`; returns true and calls `quitAndInstall` once when ready and off air; a second call returns false (no double install).
  - `check()` is ignored (no engine call) while `downloading` or `ready`.
- [x] **Step 2: Run** `npx vitest run src/main/updater/manager.test.ts`. Expected: FAIL (module missing).
- [x] **Step 3: Implement** `UpdateManager` per the interface. Every status change goes through one private `set(status)` that stores it and calls `onStatus`. Error message for display is a short fixed string ("Download failed. Check your connection and try again.") plus nothing from the exception; log the exception with `console.warn`.
- [x] **Step 4: Run** the test file. Expected: PASS.
- [x] **Step 5: Commit** `feat(update): UpdateManager with silent checks, skip, on-air gate`.

---

### Task 3: Engines, IPC and main wiring

**Files:**
- Create: `src/main/updater/electron-engine.ts`, `src/main/updater/fake-engine.ts`
- Modify: `package.json` (dependency `electron-updater`), `src/shared/ipc.ts`, `src/main/index.ts` (near the `registerIpc` call at ~line 1490 and the `settings` handlers), `src/preload/index.ts`
- Test: `npm run typecheck`, `npx vitest run`

**Interfaces:**
- Consumes: `UpdateManager`, `UpdateEngine` (Task 2); `Settings.updates` (Task 1).
- Produces:
  - `createElectronEngine(): UpdateEngine` and `createFakeEngine(opts?: { version?: string; notes?: string }): UpdateEngine` (fake: `check` resolves `{version: opts.version ?? '99.0.0', notes}` after 50 ms; `download` reports 25/50/100 then resolves; `quitAndInstall` only logs).
  - Invoke channels (`ipc.ts`): `updateStatus: 'update:status'` → `UpdateStatus`; `updateCheck: 'update:check'` → `UpdateStatus`; `updateDownload: 'update:download'` → `UpdateStatus`; `updateInstall: 'update:install'` → `boolean`; `updateSkip: 'update:skip'` → `UpdateStatus`. Broadcast: `updateStatus: 'update:status'` carrying `UpdateStatus`. Add all to `InvokeMap`, the preload `Api` (`getUpdateStatus`, `checkForUpdate`, `downloadUpdate`, `installUpdate`, `skipUpdate`, `onUpdateStatus(cb): () => void`).

- [x] **Step 1: Look up the `electron-updater` API with Context7** (`autoUpdater` properties, `checkForUpdates`, `downloadUpdate`, `download-progress` event, `update-downloaded`, `releaseNotes` shape, `quitAndInstall(isSilent, isForceRunAfter)`). Confirm in the docs that `downloadUpdate()` rejects when the file's sha512 differs from `latest.yml` (this replaces Stagecast's own SHA-256 check). Run `npm install electron-updater`.
- [x] **Step 2: Implement `createElectronEngine`** in `electron-engine.ts`: set `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowPrerelease = false`, `allowDowngrade = false`; `check()` calls `checkForUpdates()` and returns `null` when `result?.isUpdateAvailable` is false, else `{ version, notes }` where `releaseNotes` (string, array of `{version, note}`, or null) is normalized to one markdown string; `download()` forwards `download-progress` percent (rounded) and awaits `downloadUpdate()`; `quitAndInstall()` calls `autoUpdater.quitAndInstall(false, true)`. Implement `createFakeEngine` in `fake-engine.ts`.
- [x] **Step 3: Add the IPC channels** in `ipc.ts`, then handlers in `main/index.ts`: create the manager only when (`app.isPackaged` and (`process.platform === 'win32'` or (`process.platform === 'linux'` and `process.env.APPIMAGE`)) and `BRIDGECAST_NO_UPDATE_CHECK !== '1'`) or `PPT_UPDATE_FAKE === '1'`; engine is fake when `PPT_UPDATE_FAKE === '1'`. `isOnAir: () => !canInstallNow(state.state)`, `getSkipped/setSkipped` read and save `settings.updates`, `onStatus` broadcasts `Broadcast.updateStatus` to the operator window only (use the same helper other operator-only broadcasts use). When no manager exists, `update:status` returns `{ kind: 'idle' }` and the others are no-ops. Schedule `manager.check()` 15 s after the operator window is shown, then every 6 hours (`setInterval`, cleared in `before-quit`). Validate senders with the existing `appHandle`/`frameSenderAllowed` pattern (operator role only).
- [x] **Step 4: Add the preload API** methods listed in Interfaces.
- [x] **Step 5: Run** `npm run typecheck && npx vitest run`. Expected: PASS.
- [x] **Step 6: Commit** `feat(update): electron-updater engine, fake engine and IPC wiring`.

---

### Task 4: Operator UI (chip, banner, About block)

> UI task: load the `impeccable` skill, follow `DESIGN.md` and `PRODUCT.md`, use existing tokens and the existing toast/banner patterns (Home on-air banner, `CaptureWarning`). Show the user a screenshot before committing (`run` skill or the `e2e` launch with `PPT_UPDATE_FAKE=1`).

**Files:**
- Create: `src/renderer/src/update-ui.ts`, `src/renderer/src/update-ui.test.ts`, `src/renderer/src/components/UpdateBanner.tsx`
- Modify: `src/renderer/src/components/Header.tsx`, `src/renderer/src/components/SettingsDialog.tsx` (AboutSection at line 42), `src/renderer/src/App.tsx` (subscribe once, pass status down), styles under `src/renderer/src/styles/`

**Interfaces:**
- Consumes: `UpdateStatus` (Task 1) and the preload methods (Task 3).
- Produces (`update-ui.ts`):
  - `interface UpdateView { chip: { label: string } | null; banner: { title: string; detail: string; primary: { label: string; action: 'download' | 'install' | 'retry' } | null; primaryDisabledReason: string | null; showSkip: boolean; showLater: boolean } | null; progress: number | null }`
  - `updateView(status: UpdateStatus, onAir: boolean, bannerDismissedFor: string | null): UpdateView`
  - `isUpdateKeyTarget(el: Element | null): boolean` (true when keyboard events from `el` must not be treated as Program shortcuts: an update button or its container)

- [x] **Step 1: Write the failing tests** in `update-ui.test.ts`:
  - `idle`/`checking` → `{ chip: null, banner: null, progress: null }`.
  - `available 1.2.0` → chip label `'Update 1.2.0'`; banner title `'Bridgecast 1.2.0 is available'`, primary `{label:'Download', action:'download'}`, `showSkip` true, `showLater` true; with `bannerDismissedFor === '1.2.0'` banner is null but chip stays.
  - `downloading 40` → `progress: 40`, primary null.
  - `ready 1.2.0` with `onAir=false` → primary `{label:'Restart and install', action:'install'}`, `primaryDisabledReason: null`; with `onAir=true` → `primaryDisabledReason: 'Something is on air. Take it off air or wait until the show ends.'`.
  - `error` → primary `{label:'Try again', action:'retry'}`.
  - `isUpdateKeyTarget` is a plain function over `closest('[data-update-ui]')`; test it with a minimal fake element object (`{ closest: (sel) => ... }`), no DOM.
- [x] **Step 2: Run** `npx vitest run src/renderer/src/update-ui.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement `update-ui.ts`** to satisfy the tests.
- [x] **Step 4: Build the components.** Chip in `Header.tsx` beside the settings gear (visible only when `view.chip`); `UpdateBanner` renders under the header with Download / Restart and install, Later (hides the banner for this version in memory) and Skip this version (`skipUpdate`); a thin progress bar while downloading; release notes (`releaseNotesLines`) expand under "What's new" in the banner and in About. About gets a "Check for updates" button (`checkForUpdate`, shows "You're up to date" when the result is `idle` after a manual check) and the current status line. Mark every update control container `data-update-ui`. In the global key handler in `App.tsx`, return early when `isUpdateKeyTarget(document.activeElement)` for Space and Enter, so a focused update button never fires on a clicker press and Space is not swallowed from Program shortcuts; the banner never calls `focus()`.
- [x] **Step 5: Run** `npm run typecheck && npm test && npm run lint`. Expected: green, no new lint errors.
- [x] **Step 6: Screenshot and show the user** the three states (available, downloading, ready while on air) before committing.
- [x] **Step 7: Commit** `feat(update): header chip, banner and About block`.

---

### Task 5: Release pipeline and changelog

**Files:**
- Create: `CHANGELOG.md`, `scripts/release.mjs`
- Modify: `electron-builder.yml` (add `publish`), `package.json` (`release:win` script), `README.md` (release section)

**Interfaces:**
- Produces: `npm run release -- [--win|--linux] [--publish]` which builds, verifies and publishes (`release:win` and `release:linux` are shortcuts). `CHANGELOG.md` section format `## [X.Y.Z] - YYYY-MM-DD` with `### Added/Changed/Fixed`; its newest section becomes the GitHub release body (shown to operators as "What's new").

- [x] **Step 1: Configure publishing.** Add `publish: { provider: github, owner: CallMeSon, repo: ppt-share }` to `electron-builder.yml`, and set `"version": "0.1.0"` in `package.json`. (The coordinator, not you, makes the repo public with `gh repo edit` when the first real release is cut. Do not run it.)
- [x] **Step 2: Write `CHANGELOG.md`** with a `0.1.0` section (first section; summarize what Bridgecast does today from `PRODUCT.md`, plus the update feature, one line each) and an `[Unreleased]` heading above it. Add one sentence: versions restart at 0.x because the app is in development.
- [x] **Step 3: Write `scripts/release.mjs`**: (a) read `package.json` version; (b) fail unless `CHANGELOG.md` has a `## [<version>]` section and git is clean on a branch the user names with `--branch` (default `master`); (c) run `npm run build:bridge` only if `native/ppt-bridge/bin/Release/net48/ppt-bridge.exe` is missing, then `electron-builder --win --publish never` when `--win`, `electron-builder --linux AppImage --publish never` when `--linux` (default: the platforms the current OS can build; Windows installers are built on Windows); (d) check `dist/` has, per platform, `Bridgecast-<version>-setup.exe` + `latest.yml` (win) and `Bridgecast-<version>.AppImage` + `latest-linux.yml` (linux); (e) with `--publish`, run `gh release create v<version> <all built installers> <their yml files> <blockmaps> --title "Bridgecast <version>" --notes-file <extracted section>`, or `gh release upload v<version> ... --clobber` when the release already exists, so Windows and Linux builds from two machines land on the same release; without it print what would run (`--dry-run` is the default). Use `node:child_process` `execFileSync` with argument arrays.
- [x] **Step 4: Check the NDI step does not break silent updates:** read `build/install-ndi-runtime.ps1` and confirm it exits 0 at once when the NDI Runtime is already installed. If it does not, make it do so (smallest change) so an update does not redownload the runtime. Note the result in the commit body.
- [x] **Step 5: Verify:** `node scripts/release.mjs` (dry run) on Linux fails cleanly with a clear message about Windows-only packaging or prints the plan; `npm run typecheck` still passes.
- [x] **Step 6: Document** the release steps in `README.md` (bump version, edit CHANGELOG, `npm run release -- --publish` on each OS).
- [x] **Step 7: Commit** `chore(release): changelog, publish config and release script`.

---

### Task 6: End-to-end test and docs

**Files:**
- Create: `e2e/update.mjs`
- Modify: `package.json` (`test:e2e:update`; append `&& node e2e/update.mjs` to `test:e2e:all`), `PRODUCT.md` (one bullet under Capabilities: Updates), `docs/test-checklist.md` (Windows field checks)

- [x] **Step 1: Write `e2e/update.mjs`** following `e2e/tour.mjs` (spread `linuxArgs` from `e2e/launch-args.mjs`, launch with `PPT_UPDATE_FAKE=1` and a temp `PPT_SHARE_USER_DATA`). Assertions: (a) within 20 s the header chip text is `Update 99.0.0`; (b) click Download, wait for "Restart and install"; (c) with a slide taken live (import a fixture deck as other suites do), the install button is disabled and shows the on-air reason; (d) pressing Space with the Download button focused moves the Program to the next slide and does not start the download; (e) Skip this version hides chip and banner and survives a relaunch (the fake keeps offering `99.0.0`, so the relaunched app shows no chip).
- [x] **Step 2: Run** `npm run test:e2e:update` (headless: `xvfb-run -a -s '-screen 0 2560x1440x24' npm run test:e2e:update`). Expected: all assertions pass.
- [x] **Step 3: Docs.** `PRODUCT.md`: one bullet (update check at start and every 6 h, silent on failure, operator-started download, install refused on air, skip a version, `BRIDGECAST_NO_UPDATE_CHECK=1`, status "verified on Linux with a fake engine only; the real download and NSIS install are unverified on Windows"). `docs/test-checklist.md`: a section "Auto-update (Windows and Linux AppImage)", written as steps another agent can run on the user's Windows PC (exact commands, expected observations, where logs are), with: install version A, publish version B, see chip, download, install while idle, app relaunches on B with events intact; install refused while a slide is live; offline start shows nothing; NDI runtime is not redownloaded on update; quit still stops OMT cleanly after "Restart and install".
- [x] **Step 4: Run the full gate:** `npm run typecheck && npm test && npm run lint && npm run test:e2e:all` (headless as in CLAUDE.md). Expected: green, lint still 8 known errors.
- [x] **Step 5: Commit** `test(update): e2e for update flow; docs and Windows field checklist`.

---

## Self-review

- **Spec coverage:** check at start and every 6 h (Task 3), silent failure (Task 2), chip + banner once per version + Later/Skip (Task 4), release notes (Task 1, 4), hash verification (electron-updater's `latest.yml` sha512; note in Task 3 Step 1 to confirm), on-air gate (Task 2, 4, 6), env switch (Task 3), one-command release and changelog (Task 5), field checks on Windows (Task 6). UI items 2 to 5 intentionally out of scope.
- **Types:** `UpdateStatus` fields (`version`, `percent`, `message`) are the same in Tasks 1 to 4; `canInstallNow(state)` is true when off air and `isOnAir = !canInstallNow(...)` in Task 3; `UpdateManager.install(): boolean` matches the `update:install` result.
- **Known unknowns for the executor to surface, not guess:** the release repo (Task 5 Step 1); that `quitAndInstall` still launches the installer after the OMT shutdown delay in the `before-quit` handler (`src/main/index.ts:1470`), which only a Windows run can confirm (checklist item in Task 6).
