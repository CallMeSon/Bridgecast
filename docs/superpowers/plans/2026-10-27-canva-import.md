# Canva Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator pastes a Canva design link, signs in to Canva once, and the app exports every page (PNG + MP4), drops clips without animation, and adds a deck of video and image slides.

**Architecture:** A Cloudflare Worker holds the client secret and only exchanges/refreshes OAuth tokens. The main process owns PKCE login, the encrypted token, the Canva REST client and a resumable per-design job (work folder + `job.json`) that runs through the existing `ImportQueue`. Static-clip detection runs in the operator renderer (a `<video>` + canvas) and reports back to main; the finished folder goes through `readFolderDeck` and `Library.addDeck` with `source: 'canva'`.

**Tech Stack:** Electron 45, electron-vite, React 19, TypeScript, Vitest, Playwright `_electron` smoke test, Cloudflare Workers (wrangler). No new runtime dependencies in the app.

**Spec:** `docs/superpowers/specs/2026-10-09-canva-import-design.md` (results of the spike: `docs/superpowers/notes/canva-spike.md`)

## Global Constraints

- UI copy is English; errors say what happened and how to fix it (existing style). Use the spec's exact strings (section 3).
- `CANVA_CLIENT_ID` and `CANVA_AUTH_URL` come from the build environment (electron-vite `define`); both empty hides the import button. Neither is a secret. The client secret exists only as a Worker secret.
- OAuth: authorization code + PKCE S256, verifier 64 random bytes, `state` 24 random bytes, scopes `design:meta:read design:content:read`, redirect `http://127.0.0.1:3001/oauth/redirect`, local server closed after one redirect or 5 minutes.
- Canva API base `https://api.canva.com/rest/v1`; MP4 export `{ type: 'mp4', quality: 'horizontal_1080p', pages: [n] }`; at least 3,2 s between exports; poll every 1,5 s; download 90 s timeout, 3 attempts; 429 waits `Retry-After` (default 15 s), 5 in a row stops the job.
- The token never reaches the renderer (only `signed-in` / `signed-out`). PKCE verifier and `state` never leave main.
- Downloads: `https:` only, host must match `CANVA_DOWNLOAD_HOSTS`, file names are built by the app. Work folder `userData/canva-imports/<designId>/`.
- Test-only overrides (`CANVA_API_BASE`, `CANVA_AUTHORIZE_URL`, loopback download hosts) are honored only when `PPT_OUTPUT_DUMP` is set (the existing test switch).
- Comments and naming follow the surrounding code (short JSDoc on exported functions, explain why).

## Review Focus

1. Pasted text that is not a design: a short link (`canva.link/...`), a `canva.com/design/<ID>/view?utm=...` URL with query/hash, a template or folder link. Expect: accepted ID for the first design shapes, the `Paste a Canva design link (canva.com/design/…).` message for the rest. Test in Task 1.
2. Browser redirect with a wrong `state`, an `error=access_denied` query, or a second request to the local server. Expect no tokens saved, server closed, `Canva login was cancelled.` / `Canva login failed. Try again.`. Test in Task 3.
3. Two Canva calls hit 401 at the same time. The refresh token is single-use, so the second refresh would fail and log the operator out. Expect one shared refresh. Test in Task 3.
4. App closed or network cut while a file is half written. Expect resume to redownload that page (files are written as `.part` then renamed; `job.json` lists only finished pages). Test in Task 4.
5. The same design imported twice at once, or a design whose export returns fewer URLs than `page_count`. Expect the second request rejected with a clear message / an error naming the missing page. Test in Task 4 and Task 5.

---

## File Structure

- `src/shared/canva.ts` (new): `parseDesignRef`, `isStaticClip`, `CANVA_DOWNLOAD_HOSTS`, `isAllowedDownloadUrl`, shared IPC types.
- `src/main/canva/pkce.ts` (new): PKCE and `state`.
- `src/main/canva/token-store.ts` (new): encrypted token file.
- `src/main/canva/auth.ts` (new): login server, token exchange through the Worker, refresh, logout.
- `src/main/canva/client.ts` (new): authenticated REST calls, error mapping, 429 handling.
- `src/main/canva/importer.ts` (new): export + download + resume + finalize.
- `server/canva-auth/` (new): Worker (`src/handler.ts`, `src/index.ts`, `wrangler.toml`, `README.md`).
- Modified: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/library.ts`, `src/main/slide-protocol.ts`, `electron.vite.config.ts`, `vitest.config.ts`, `src/renderer/src/components/Library.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/OutputMenu.tsx`, `docs/test-checklist.md`, `PRODUCT.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md`.
- New renderer: `src/renderer/src/import/canva-static.ts`, `src/renderer/src/components/CanvaImport.tsx`.
- Tests next to each file; e2e in `e2e/canva.mjs` with `e2e/fake-canva.mjs`.

---

### Task 1: Pure helpers

**Files:**
- Create: `src/shared/canva.ts`, `src/shared/canva.test.ts`

**Interfaces:**
- Produces:
  - `parseDesignRef(input: string): string | null` (design ID or null)
  - `isStaticClip(first: Uint8ClampedArray, last: Uint8ClampedArray): boolean` (RGBA frames, same length; mean absolute difference over R, G, B only; `< 1.0` is static; different lengths or empty return `false`)
  - `CANVA_DOWNLOAD_HOSTS: readonly string[]` (domain suffixes)
  - `isAllowedDownloadUrl(url: string, opts?: { allowLoopback?: boolean }): boolean`
  - `STATIC_FRAME = { width: 160, height: 90, firstAtSeconds: 0.1 }`

- [ ] **Step 1: Write failing tests** in `canva.test.ts`:
  - `parseDesignRef`: `'https://www.canva.com/design/DAHW22aaX-w/AbCd_1/edit'` → `'DAHW22aaX-w'`; `'canva.com/design/DAHW22aaX-w/view?utm_source=x#y'` → `'DAHW22aaX-w'`; `'  DAHW22aaX-w '` → `'DAHW22aaX-w'`; `'https://canva.link/abc'`, `'https://www.canva.com/folder/abc'`, `'https://evil.com/design/DAHW22aaX-w'`, `''`, `'a b'` → `null`.
  - `isStaticClip`: identical frames → `true`; every channel off by 0.9 average → `true`; off by 1.0 → `false`; alpha-only difference → `true`; different lengths → `false`.
  - `isAllowedDownloadUrl`: `http://` of an allowed host, a host `evil-canva.com`, `canva.com.evil.com`, userinfo tricks (`https://canva.com@evil.com/x`) → `false`; `https://127.0.0.1:4000/x` → `false` unless `allowLoopback`.
- [ ] **Step 2: Run** `npx vitest run src/shared/canva.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** in `src/shared/canva.ts`. `CANVA_DOWNLOAD_HOSTS` starts as `['canva.com']` and Task 4 completes it from a real export (see Manual prerequisites). Match with `host === s || host.endsWith('.' + s)` on `new URL(url).hostname`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: canva link parser, static clip check and download host check`

### Task 2: Worker `canva-auth`

**Files:**
- Create: `server/canva-auth/src/handler.ts`, `server/canva-auth/src/index.ts`, `server/canva-auth/wrangler.toml`, `server/canva-auth/README.md`
- Test: `server/canva-auth/src/handler.test.ts`
- Modify: `vitest.config.ts` (include `server/**/*.test.ts`), `eslint.config.mjs` and `tsconfig.node.json` if they exclude `server/` (keep lint and typecheck green)

**Interfaces:**
- Produces: `handle(request: Request, env: { CANVA_CLIENT_ID: string; CANVA_CLIENT_SECRET: string }, fetchImpl?: typeof fetch): Promise<Response>`; `index.ts` default-exports `{ fetch: (req, env) => handle(req, env) }`.

- [ ] **Step 1: Write failing tests** in `handler.test.ts` with a fake `fetchImpl` that records the request:
  - `POST /token` `{ code, code_verifier, redirect_uri: 'http://127.0.0.1:3001/oauth/redirect' }` calls `https://api.canva.com/rest/v1/oauth/token` with `Authorization: Basic base64(id:secret)`, `content-type: application/x-www-form-urlencoded`, body `grant_type=authorization_code&code=…&code_verifier=…&redirect_uri=…`; returns the upstream body and status unchanged.
  - `POST /refresh` `{ refresh_token }` sends `grant_type=refresh_token&refresh_token=…`.
  - Rejected with 4xx and no upstream call: `GET` (405), another path (404), `content-type: text/plain` (415), body over 8 KB (413), invalid JSON or missing fields (400), `redirect_uri` `http://evil.com/oauth/redirect` and `http://127.0.0.1:3001/other` (400).
  - Response carries no `access-control-allow-origin`; nothing is passed to `console.*` (spy) in any case.
- [ ] **Step 2: Run** `npx vitest run server/canva-auth`. Expected: FAIL.
- [ ] **Step 3: Implement** `handler.ts` per the spec (section 1 and 4). Redirect check: `^http://127\.0\.0\.1:\d+/oauth/redirect$`.
- [ ] **Step 4: Add** `wrangler.toml` (name `ppt-share-canva-auth`, `main = "src/index.ts"`) and a README with the deploy commands (`wrangler secret put CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `wrangler deploy`). Run the tests, `npm run lint`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: canva-auth worker`

### Task 3: PKCE, token store, login and refresh

**Files:**
- Create: `src/main/canva/pkce.ts`, `src/main/canva/token-store.ts`, `src/main/canva/auth.ts` and a `.test.ts` for each

**Interfaces:**
- Produces:
  - `createPkce(): { verifier: string; challenge: string; state: string }`; `stateMatches(expected: string, got: string): boolean` (constant time).
  - `type Tokens = { accessToken: string; refreshToken: string; expiresAt: number }`; `class TokenStore { constructor(file: string, crypto: { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }); get(): Tokens | null; set(t: Tokens): void; clear(): void }`. Encryption unavailable: memory only, nothing written.
  - `class CanvaAuth { constructor(o: { clientId: string; authUrl: string; store: TokenStore; fetch: typeof fetch; openExternal: (url: string) => Promise<void>; now?: () => number; port?: number; loginTimeoutMs?: number }); status(): 'signed-in' | 'signed-out'; login(): Promise<void>; getAccessToken(): Promise<string>; refreshAfter401(): Promise<string>; logout(): void }`. Errors use the spec strings; `getAccessToken` refreshes when `expiresAt - now < 60_000`; `refreshAfter401` shares one in-flight refresh with `getAccessToken` and with parallel callers.

- [ ] **Step 1: Write failing tests**:
  - pkce: `challenge === base64url(sha256(verifier))`; verifier is 86 chars (64 bytes); two calls differ; `stateMatches` true/false.
  - token-store: round trip with a fake `crypto`; the file on disk does not contain the access token text; unavailable encryption writes no file; a corrupt file reads as `null`; `clear()` removes the file.
  - auth (fake fetch, fake `openExternal` that performs the redirect with `fetch` to the local server): successful login stores tokens and closes the server; wrong `state` → `Canva login failed. Try again.` and no tokens; `error=access_denied` → `Canva login was cancelled.`; no redirect within `loginTimeoutMs` → cancelled and port released; port already used → error naming port 3001; Worker unreachable (fetch rejects) → `Cannot reach the Canva sign-in service. Check the internet connection, then try again.`; a second request to the local server after the first is refused (Review Focus 2).
  - auth: token near expiry triggers one `/refresh` and stores the new pair; two parallel `refreshAfter401()` calls produce one `/refresh` request (Review Focus 3); a failed refresh clears the token and `status()` is `signed-out`.
- [ ] **Step 2: Run** `npx vitest run src/main/canva`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files. The local server uses `node:http` bound to `127.0.0.1`, answers the browser with a short "You can close this tab" page.
- [ ] **Step 4: Run** the same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: canva login with pkce, encrypted token and single-flight refresh`

### Task 4: REST client and resumable importer

**Files:**
- Create: `src/main/canva/client.ts`, `src/main/canva/importer.ts` and a `.test.ts` for each

**Interfaces:**
- Consumes: `CanvaAuth.getAccessToken` / `refreshAfter401`, `isAllowedDownloadUrl`, `readFolderDeck` (`src/main/import/folder.ts`).
- Produces:
  - `class CanvaClient { constructor(o: { base: string; auth: Pick<CanvaAuth, 'getAccessToken' | 'refreshAfter401'>; fetch: typeof fetch; sleep: (ms: number) => Promise<void> }); getDesign(id: string): Promise<{ title: string; pageCount: number }>; startExport(id: string, format: { type: 'png' } | { type: 'mp4'; page: number }): Promise<string>; pollExport(exportId: string): Promise<{ status: 'in_progress' } | { status: 'success'; urls: string[] } | { status: 'failed'; code: string; message: string }> }`. 401 → one `refreshAfter401` then retry; 403/404 on a design → the spec's access message; 429 waits `Retry-After` and retries, fifth consecutive throws `CanvaStoppedError`.
  - `class CanvaStoppedError extends Error { constructor(readonly page: number | null, message: string) }` (the job can be resumed).
  - `type ImportDeps = { client: CanvaClient; workRoot: string; download: (url: string, file: string) => Promise<void>; sleep: (ms: number) => Promise<void>; analyze: (designId: string, mp4Pages: number[]) => Promise<number[]>; addDeck: (deck: FolderDeck) => void; onProgress: (p: { percent: number; message: string }) => void }`
  - `runCanvaImport(deps: ImportDeps, designId: string): Promise<void>`; `cancelCanvaImport(workRoot: string, designId: string): void` (removes the work folder).
  - `downloadToFile(url: string, file: string, o: { fetch: typeof fetch; timeoutMs?: number; attempts?: number }): Promise<void>` writes `<file>.part` then renames; throws `CanvaStoppedError` after the last attempt.

- [ ] **Step 1: Write failing tests** for the client (fake `fetch`/`sleep`): 401 then success retries once with the refreshed token; 404 → `This Canva account cannot open the design. Ask the owner to share it with you, then try again.`; export `failed` with `license_required` / `approval_required` / `internal_failure` → the spec's advice (`Remove or license the Pro elements on page N`, `Ask a team admin to approve the design`, `Try again later`); 429 with `Retry-After: 2` sleeps 2000 ms; 5 consecutive 429 → `CanvaStoppedError`.
- [ ] **Step 2: Write failing tests** for the importer (fake client, temp work folder, fake download that writes a byte or a real fixture PNG from `fixtures/`):
  - 3 pages: exports PNG once, then MP4 pages 1..3 in order with `sleep(3200)` between exports; `job.json` lists finished pages after each page; `onProgress` messages include `Exporting images…`, `Page 2 / 3 · exporting video`, `Waiting for Canva (rate limit)…`, `Checking animations…`, `Adding deck…`.
  - Static pages from `analyze` lose their MP4 before `addDeck`; the deck passed to `addDeck` has `video` only on the animated pages; the work folder is removed afterwards.
  - Resume: server fails page 3 once (`CanvaStoppedError(3, …)`); the second `runCanvaImport` does not call `startExport` / `download` for pages 1-2 and finishes (Review Focus 4: a leftover `page-02.mp4.part` is ignored and the page is downloaded again).
  - Fewer URLs than `pageCount` → error `Canva returned 26 of 28 pages. Try the import again.` (numbers from the case).
  - A download URL whose host is not allowed → `Canva returned an unexpected download address.` and nothing is written.
- [ ] **Step 3: Run** `npx vitest run src/main/canva`. Expected: FAIL.
- [ ] **Step 4: Implement** both files. `job.json` shape: `{ title: string; pageCount: number; pngDone: boolean; mp4Done: number[] }`. The deck name is `title`; width/height come from `readFolderDeck`.
- [ ] **Step 5: Run** the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: canva client and resumable importer`

### Task 5: Wire into main, IPC and the work-folder protocol

**Files:**
- Modify: `src/shared/types.ts` (`DeckMeta.source` adds `'canva'`), `src/main/library.ts` (`DeckInput.source` adds `'canva'`), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/slide-protocol.ts`, `electron.vite.config.ts`
- Test: `src/main/slide-protocol.test.ts`, `src/shared/smoke.test.ts` (keep IPC map in sync, follow how it checks existing channels), `src/main/canva/wiring.test.ts` only if logic lands outside `index.ts`

**Interfaces:**
- Produces in `ipc.ts`:
  - `Invoke.canvaImport = 'canva:import'` `{ args: [eventId: string, req: { id: string; link: string }]; result: void }` (validates the link with `parseDesignRef`, rejects a design already running)
  - `Invoke.canvaResume = 'canva:resume'` `{ args: [id: string]; result: void }`, `Invoke.canvaCancel = 'canva:cancel'` `{ args: [id: string]; result: void }`
  - `Invoke.canvaStatus = 'canva:status'` `{ args: []; result: { enabled: boolean; signedIn: boolean } }`, `Invoke.canvaLogout = 'canva:logout'` `{ args: []; result: void }`
  - `Invoke.canvaAnalysisResult = 'canva:analysisResult'` `{ args: [requestId: string, staticPages: number[]]; result: void }`
  - `Broadcast.canvaAnalyze = 'canva:analyze'` payload `{ requestId: string; designId: string; pages: number[] }`; `Broadcast.canvaSignedIn = 'canva:signedIn'` payload `boolean`
  - `ImportProgress.status` adds `'stopped'`; `ImportProgress` adds `resumable?: boolean`. Busy rows use `message` for the progress text.
  - `Api` gets `importCanva`, `resumeCanva`, `cancelCanva`, `getCanvaStatus`, `logoutCanva`, `onCanvaAnalyze`, `canvaAnalysisResult`, `onCanvaSignedIn`.
- slide protocol: `slide://canva-work/<designId>/page-NN.mp4|png` with the same range handling as deck videos; `designId` must match `^[A-Za-z0-9_-]+$`, the file `^page-\d+\.(png|mp4)$`, and the resolved path must stay inside `userData/canva-imports/<designId>/`. Existing `kv` host and uuid decks unchanged.

- [ ] **Step 1: Write failing tests**: slide-protocol serves a work file with a `Range` header; `designId` `..%2f..`, a file name `../job.json` and a symlink outside the folder are refused; `smoke.test.ts` expectations for the new channels.
- [ ] **Step 2: Run** `npx vitest run src/main/slide-protocol.test.ts src/shared`. Expected: FAIL.
- [ ] **Step 3: Implement** the protocol host, then the types and IPC plumbing. In `index.ts` create `TokenStore` (`userData/canva-token.bin`, Electron `safeStorage`), `CanvaAuth`, `CanvaClient` and a second `ImportQueue` (concurrency 1) for Canva jobs. Login happens at the start of a job when `status()` is `signed-out` (progress `Signing in to Canva…`). `CanvaStoppedError` reaches the row as `status: 'stopped'`, `resumable: true`, message `Stopped at page N` (or the error message when `page` is `null`); other errors as `error`. `analyze` broadcasts `canva:analyze` to the operator window and resolves on `canva:analysisResult` (or after 120 s with no static pages, which keeps every video). In `electron.vite.config.ts` set `main.define` for `__CANVA_CLIENT_ID__` and `__CANVA_AUTH_URL__` from `process.env` (empty string when unset) and declare them in a `.d.ts`. `CANVA_API_BASE` / `CANVA_AUTHORIZE_URL` overrides only when `process.env.PPT_OUTPUT_DUMP` is set. Log out and `canva:status` never return tokens.
- [ ] **Step 4: Run** `npx vitest run` and `npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: canva import wired into main and ipc`

### Task 6: Static detection in the renderer

**Files:**
- Create: `src/renderer/src/import/canva-static.ts`, `src/renderer/src/import/canva-static.test.ts`
- Modify: `src/renderer/src/App.tsx` (subscribe to `onCanvaAnalyze`, answer with `canvaAnalysisResult`)

**Interfaces:**
- Consumes: `isStaticClip`, `STATIC_FRAME` (Task 1), `slide://canva-work/...` (Task 5).
- Produces: `detectStaticPages(designId: string, pages: number[], deps?: { grab: (url: string, atSeconds: number | 'end') => Promise<Uint8ClampedArray> }): Promise<number[]>` (page numbers whose clip is static). A page whose clip cannot be decoded is **not** static (the video is kept).

- [ ] **Step 1: Write failing tests** with a fake `grab`: pages 2 and 7 identical frames → `[2, 7]`; animated page → excluded; `grab` rejecting for page 4 → excluded, others still analyzed; order preserved; pages are analyzed one at a time.
- [ ] **Step 2: Run** `npx vitest run src/renderer/src/import/canva-static.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `detectStaticPages` and the default `grab` (muted `<video>`, `preload="auto"`, seek, `drawImage` on a 160x90 canvas, `getImageData`; `'end'` seeks to `duration`).
- [ ] **Step 4: Run** the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: detect static canva clips in the renderer`

### Task 7: UI

**Files:**
- Create: `src/renderer/src/components/CanvaImport.tsx`
- Modify: `src/renderer/src/components/Library.tsx` (button next to **Add files**, `stopped` rows with **Resume** / **Cancel**), `src/renderer/src/App.tsx` (state and handlers), `src/renderer/src/components/OutputMenu.tsx` (signed-in status and **Log out of Canva**), `src/renderer/src/model.ts` only if progress mapping lives there
- Test: `src/renderer/src/model.test.ts` (or the file that already tests import rows)

**Interfaces:**
- Consumes: the `Api` additions from Task 5.
- Produces: the **Import from Canva** button (hidden when `getCanvaStatus().enabled` is false); popover with one input labelled `Canva design link` and an **Import** button; an invalid link shows `Paste a Canva design link (canva.com/design/…).` under the input without closing the popover; rows with `status: 'stopped'` show their message plus **Resume** and **Cancel**; Output menu line `Canva: signed in` + **Log out of Canva** (only when signed in).

- [ ] **Step 1: Write failing tests** for the pure parts (row mapping from `ImportProgress` including `stopped`/`resumable`, and the validation message), in the same style as the existing import-row tests.
- [ ] **Step 2: Run** `npx vitest run src/renderer`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and wiring; follow `DESIGN.md` for the popover and reuse the existing import row component and its progress bar. Keyboard: the input takes focus on open, Enter imports, Escape closes.
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: import from canva in the library panel`

### Task 8: End-to-end with a fake Canva, docs and checklist

**Files:**
- Create: `e2e/fake-canva.mjs`, `e2e/canva.mjs`
- Modify: `package.json` (`test:e2e` also runs `e2e/canva.mjs`), `docs/test-checklist.md`, `PRODUCT.md`, `docs/superpowers/specs/2026-10-06-ppt-share-design.md` (Canva no longer out of scope), `docs/superpowers/plans/2026-10-09-video-slides.md` (tick completed steps is optional; skip if unsure)

**Interfaces:**
- `fake-canva.mjs` exports `startFakeCanva(o: { fixtureDir: string; failPageOnce?: number; pages: number; staticPages?: number[] }): Promise<{ url: string; close(): Promise<void> }>` serving `authorize` (redirects at once with a code), `/token`, `/refresh`, `GET /designs/:id` (404 for id `MISSING`), `POST /exports`, `GET /exports/:id`, and download URLs pointing at `fixtures/video-deck` files (`scripts/make-video-fixture.cjs` makes MP4s; a static MP4 fixture is needed for `staticPages`).

- [ ] **Step 1: Write** `e2e/canva.mjs` (modelled on `e2e/smoke.mjs`; app started with `PPT_OUTPUT_DUMP`, `CANVA_API_BASE`, `CANVA_AUTHORIZE_URL`, `CANVA_AUTH_URL` pointing at the fake) with the four cases from the spec: full 5-page import (deck `source: 'canva'`, video pages are video slides); static page becomes an image slide; page 3 fails once → row text `Stopped at page 3`, **Resume** finishes and the fake server saw no second download for pages 1-2; design `MISSING` → the access message.
- [ ] **Step 2: Run** `node e2e/canva.mjs` after `npx electron-vite build`. Expected: FAIL until the earlier tasks are in place; fix the app (not the test) for real failures.
- [ ] **Step 3: Run** the whole suite: `npm run typecheck && npm run lint && npm test && npm run test:e2e`. Expected: all PASS.
- [ ] **Step 4: Update docs**: add a "Canva" section to `docs/test-checklist.md` (deploy Worker, sign in with a real account, import an animated design, cut Wi-Fi mid-import then Resume, log out and sign in again, run with no internet after import); update `PRODUCT.md` and the original spec's out-of-scope line.
- [ ] **Step 5: Commit** `test: canva import e2e and docs`

---

## Manual prerequisites (not done by the agent)

1. **Canva Developer Portal** (canva.dev): the integration used for the spike, or a new Public integration. Check: scopes `design:meta:read` and `design:content:read`; redirect URL exactly `http://127.0.0.1:3001/oauth/redirect`; keep the **Client ID**; generate a **Client secret** (never paste it in chat).
2. **Cloudflare**: account, `npx wrangler login`, then from `server/canva-auth/`: `wrangler secret put CANVA_CLIENT_ID`, `wrangler secret put CANVA_CLIENT_SECRET`, `wrangler deploy`. Keep the Worker URL (`https://ppt-share-canva-auth.<subdomain>.workers.dev`).
3. **Build environment**: set `CANVA_CLIENT_ID` and `CANVA_AUTH_URL` (the Worker URL) in the shell or CI that runs `npm run build:win`. Without them the Canva button is hidden.
4. **Download hosts**: run `node scripts/canva-spike.mjs <design link>` once (needs `.superpowers/canva-spike/canva.env`; the spike data folder is currently gone) and send me the *host names* of the export URLs (not the full URLs, they are signed) so `CANVA_DOWNLOAD_HOSTS` is complete before Task 4 ships.
5. **Test designs** in Canva: one animated presentation (the Bimtek one works) and one with a Pro-only element (to see `license_required`). Optional: a design that contains a video (pages 5/12/21 in the spike).
6. **Access**: until Canva approves the integration, only the integration owner's account can sign in. A client's design must be shared to that account. Submitting the integration for **Canva review** is an administrative step for you, and it is needed before any other operator account can log in.
7. **Port 3001** free on the operator PC during sign-in (Windows may ask for a firewall confirmation for the local listener).
8. **Event-PC check** with `docs/test-checklist.md` (Canva section): real account, real deck, Wi-Fi cut in the middle, then Resume.

---

## Self-review

- Spec coverage: Worker (Task 2), PKCE/token/refresh/logout (3), export/resume/hosts/errors/rate limit (4), `source: 'canva'`, folder protocol, build config, IPC (5), static detection (6), UI incl. status and log out (7), tests and manual checklist (8). The spec's "unit: link parser, PKCE, token store, export queue, `isStaticClip`, Worker validation" are in Tasks 1-4.
- Type consistency: `CanvaStoppedError`, `ImportDeps`, `detectStaticPages`, and the IPC names are defined once and reused unchanged.
- Decision beyond the spec: Canva jobs use their own `ImportQueue` instance (PowerPoint COM serialization is unrelated, and a long Canva export must not block PPTX imports), and the renderer reads work-folder files through a `slide://canva-work` host so the renderer does not need `file://` access (check how the existing windows load media before choosing otherwise).
