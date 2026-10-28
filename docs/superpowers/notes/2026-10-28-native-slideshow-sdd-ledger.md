# Native slideshow: SDD ledger (copied 2026-10-28)

Copy of the local, gitignored ledger `.superpowers/sdd/2026-10-27-native-slideshow/progress.md` so a cloud session can see the rulings and deferred minors. Plan: docs/superpowers/plans/2026-10-27-native-slideshow.md. Tasks 2-9 done and reviewed; Task 10 (e2e + docs) is WIP, see the last commit.

# SDD ledger — plan: docs/superpowers/plans/2026-10-27-native-slideshow.md
Spec: docs/superpowers/specs/2026-10-27-native-slideshow-design.md (read by subagents as needed)
Branch: feat/ppt-share (user's working branch; no worktree, user practice). Models: sonnet/medium per user memory; opus on stuck.
Preflight scan:
| item | finding |
| T1 spike (Windows, user-run) | gate: checklist item 1 fails -> stop, back to brainstorming. T2 step4 and T5 step3 also need user on Windows |
| T2<->T3 | T3 consumes Playback/clicks/hidden types from T2: ok |
| T3<->T4 | manager dispatches enginePosition/nativeFallback from T3: ok |
| T4<->T5 | bridge protocol from T4 consumed by T5: ok |
| T6<->T7 | both change model.ts outputSource; T7 adds 'pdf' kind after T6 'stream desktop': sequential, ok |
| T8<->T2 | replaceDeckFiles reuses ImportedDeck from T2: ok |
| preconditions | dotnet 8 present; prior plans on same branch; fixtures/sample-anim.pptx MISSING (user makes it in T1) |
Ruling: T1 prepared by agent, run by user — plan mandates it; hard gate before T2+ — wrong gate order costs rework of T2-T10.
Task 1: spike prepared (~/ppt-spike, note docs/superpowers/notes/native-ppt-spike.md, uncommitted); WAITING on user: fixtures/sample-anim.pptx + Windows run. Gate = checklist item 1. Minor: spike polls instead of COM events; electron pinned ^42 in spike (repo 45).
Ruling: user waived the Windows gate (T1 spike, no fixture) — user said no Windows PC now — Windows-only steps (T2 s4, T5 s3, T6 confirm, spike) deferred to the user's checklist; if the capture approach fails on Windows, T5/T6 need rework.
Task 2: implemented 807221a (DONE_WITH_CONCERNS: ps1 untested, setPlayback no IPC yet, meta playback unsanitized)
Task 2: review: spec OK; Important x2 (readDeck/playbackOf unsanitized; PDF deck 'vector' without source.pdf) -> fix round 1 dispatched (resume implementer)
Task 2: minor (deferred): ps1 media check misses media inside group shapes (recurse GroupItems); ps1 no log when sequence read fails; two different password messages in friendlyError; sourcePath not tied to rendered pages; setPlayback has no IPC (Task 8/9 adds deck:setPlayback)
Task 2: open Windows check (user): import fixtures/sample-anim.pptx + sample-4x3.pptx, verify manifest; ps1 never run
Task 2: fix round 1/5 (2 addressed, 0 open; commits 807221a..8359fb5)
Task 2: complete (commits e017e20..8359fb5, review clean; Windows check open)
Task 3: implemented aa535e9 (DONE_WITH_CONCERNS: step optional; engineReady is 6th ctor param; step move while not ready falls back to images)
Task 3: minor (deferred): fallback not sticky in reducer (moveTo recomputes playback; sticky only via AppState engineReady=false) — enginePosition overwrites state.index/pending cue when states differ — untested AppState paths (step move while not ready, enginePosition bypass) — playbackOf(deck as DeckMeta) cast — selectDeck/nextDeck can land on hidden slide 0
Ruling: ShownSlide.step stays optional (read as step ?? 0) — 40 test type sites otherwise — consumers in T4/T6/T9 must use `?? 0`.
Ruling: T4/T6 carry-forward: engineReady(deckId) MUST be false whenever nativeFallback is dispatched or the engine is down; engine/manager MUST dispatch enginePosition after every navigation incl. slide changes — wrong: next take goes native into a dead engine.
Task 3: complete (commits 8359fb5..aa535e9, review clean)
Task 4: implemented 762d2a2 (DONE_WITH_CONCERNS: manager ctor 6th param fileOf; optional engine.ping() T5 must implement; resume does goto+next x step)
Task 4: review: spec NOT ok (no test for engine/reducer disagreement), Critical x1 (hung call blocks drive chain forever), Important x4 (pingInFlight stuck, shutdown hang, failDeck leaks session, missing tests) -> fix round 1 dispatched
Task 4: minor (deferred): open retry no backoff/cap; goto+next x step emits intermediate enginePosition (step flicker); ping answered off open path (T5); T5 shutdown() must kill only bridge-opened processes; T5 must implement ping()
Task 4: fix round 1/5 (S1+C1+I1-I4 addressed, 0 open; commits 762d2a2..16a05c3)
Task 4: minor (deferred): slow healthy engine call past HANG_MS may overlap next move; failDeck close not awaited; withTimeout timers pending after dispose
Task 4: complete (commits aa535e9..16a05c3, review clean)
Ruling: T5 may poll View.CurrentShowPosition/GetClickIndex every ~50 ms instead of hooking COM events (late-bound sink needs DispIds nobody can verify on Linux) — plan says events "verified with" those calls, polling satisfies the verification — risk: latency/CPU on Windows, revisit after the user's Windows run.
Task 5: implemented e4930e7 (DONE_WITH_CONCERNS: bridge compile-only, untested on Windows; hard kill after mute leaves PPT volume 0; PPT launched by hung helper never killed; helper-error copy has no UI until T9; added Library.sourceFilePath)
Task 5: review: Critical C1 (ShowType const 1=Speaker fullscreen, must be 2=Window), Important I1 (hang detection ~5s not 3s; long open/edit exempt from ping), I2 (foreign PPT: DisplayAlerts + mute/volume touched), I3 (volume left 0 after hard kill; restore after CloseSession ordering), I4 (hung bridge-launched PPT never recovered) -> fix round 1 dispatched
Task 5: minor (deferred): window placement not configurable (M1), RCW release in Poll (M2), Audio.cs robustness (M3), edit window not activated (M4), English-only password match (M5), shutdown/new open race (M6), dpi from primary display (M7), no C# unit tests / createSlideShow untested (M8)
Ruling: PPT_BRIDGE_LOCAL_MUTE default OFF until verified on Windows that muting the PowerPoint session does not silence loopback — if mute silences capture, outputs would be silent (worse than doubled local sound) — cost: operator hears slideshow sound on the PC's default device too until verified (matches the existing "plays on this PC's default device only" copy).
Task 5: fix round 1/5 (C1,I1,I2,I3 addressed; I4 kill-by-PID introduces new Important: operator may attach own files to the bridge-launched PPT, kill would destroy unsaved work; commits e4930e7..dfdaf4b) -> round 2 dispatched
Ruling: remove automatic kill-by-PID of a hung bridge-launched PowerPoint — global rule "never kills a POWERPNT.EXE that holds files it did not open" cannot be proven safe without Windows (a hung PPT cannot answer Presentations.Count) — cost: after a hang of a PPT the bridge launched, recovery needs the operator to close that PowerPoint themselves; fallback to PNG still works; keep the `app` event informational.
Task 5: minor (deferred): Audio.Persist overwrites restore file without merge/atomic write, restore fire-and-forget races new bridge; ping false positives on legit >1s COM stall or >5s non-pumping open (Windows tune); defaultKillPid pid reuse (moot after ruling)
Task 5: fix round 2/5 (kill removed, 0 open; commits dfdaf4b..7cf03b5)
Task 5: complete (commits 16a05c3..7cf03b5, review clean; bridge compile-only, untested on Windows)
Task 6: implemented 9f1e524 (DONE_WITH_CONCERNS: slideshow:frame doesn't gate ready(); Freeze/Black/KV don't silence PPT sound on native slide; worklet load failure silent; monitor aria-label changed). smoke.mjs red at baseline same as before
Task 6: review: Important I1 (Black/KV leave PPT sound on air: soundWanted/fallbackVolume/SlideSound.program ignore black/kv), I2 (ready gate hasFrame not enforced; dead code) -> fix round 1 dispatched for I1 + FakeEngine digit ids
Ruling: spec ready gate (first captured frame) NOT built in this plan run — a precapture of the next native deck is only meaningful/verifiable on Windows (WebPrecapture pattern exists) and a deadlock risk if gated without it; mitigations present: previous layer stays until first frame, poster after 3 s — cost: first frame of a freshly opened show window might be black/unpainted on air; add to Windows checklist and revisit after the user's Windows run. Remove or document hasFrame as telemetry-only.
Ruling: Freeze keeps PPT sound (frozen picture, sound continues) — consistent with web/video — document in checklist.
Task 6: minor (deferred): worklet load failure only warns (no operator note); PcmFanout no port close listener; pre-opened next native deck media autostart may leak into live loopback (Windows check); warning kind from deck meta not shown slide; AudioContext + worklet created in every output window on mount; WGC vs GDI occluded capture and cursor capture (Windows check)
Task 6: fix round 1/5 (I1, I2 deviation, minor3 addressed, 0 open; commits 9f1e524..ef5fbdd)
Task 6: complete (commits 7cf03b5..ef5fbdd, review clean; Windows-only parts untested; first-frame ready gate deferred by ruling)
Task 7: implemented 6692647 (DONE_WITH_CONCERNS: no visual check; Black then same page reloads doc; no canvas pixel cap)
Task 7: review: spec gap (plan-mandated unrenderable-page test missing), Important x2 (no canvas pixel cap; missing test) -> fix round 1 dispatched
Task 7: minor (deferred): Black->same page reloads doc and 3 s PDF_PENDING_MS includes load time; poster state sticky after failure; FIFO not LRU eviction; layer canvas duplicates cached canvas
Task 7: fix round 1/5 (I1, I2, minor4 addressed, 0 open; commits 6692647..66ad397)
Task 7: complete (commits ef5fbdd..66ad397, review clean)
Task 8: implemented c7003c5 (DONE_WITH_CONCERNS: revertDeck returns original path, copy inside replaceDeckFiles; playback rule cannot tell default vector from chosen; PNG names unchanged so T9 cache-bust; added deck:isEdited + deck:editError; manager.suspend/resume for file lock)
Task 8: review: Important I1 (playback rule overrides operator-chosen Vector -> Native after edit), I2 (Windows-only: Revert/done can leave stale edit.* that resurrects reverted edits) -> fix round 1 dispatched
Task 8: minor (deferred): no crash recovery for swap (.old-*/.new-* sweep at startup); revert with only a pending edit throws "not edited"; queued-job race cancels pending revert; run chain bypass by leftAir/apply; no retry on snapshot copy EBUSY (Windows); sync whole-file reads (sameFile) block main; destructive IPC allows output windows; stale thumbnail job; pending edits lost on quit without notice; no IPC validation tests
Ruling: revertDeck returning original path (copy inside replaceDeckFiles) accepted — safer, end state equals brief.
Task 8: fix round 1/5 (I1, I2, minor addressed, 0 open; commits c7003c5..4328977)
Task 8: complete (commits 66ad397..4328977, review clean; Windows-only parts untested)
Task 9: implemented 718078b (DONE_WITH_CONCERNS: row label wraps in Fallback at 255px; added slideshow:status channel; nextView skips hidden; Done editing item; resumeNative via manager; keyboard-only not scripted)
Task 9: review: spec ok; Important I1 (Done editing disappears after first save: pending:false clears `editing`), I2 (focus lost after Revert confirm) -> fix round 1 dispatched (+ row wrap css, verify output-window cache-bust, nextView next-deck hidden)
Task 9: minor (deferred): editing/pending state not restored on window reload; .clk contrast check; duplicate import/cast hack in App.tsx; no component tests for NativeNotices/menu/status handler
Task 9: fix round 1/5 (I1, I2, cosmetic, a, b addressed, 0 open; commits 718078b..e7ad5be)
Task 9: minor (deferred): operator monitor source built with outputSource(program) without version, may show stale image after Apply now
Task 9: complete (commits 4328977..e7ad5be, review clean)
Ruling: T10 native e2e goes in a new e2e/native.mjs + `npm run test:e2e:native` (like web/network) instead of e2e/smoke.mjs — smoke is red at baseline ("a hidden output window mutes its video") and stops before later checks, so checks added there would never run — cost: `npm run test:e2e` does not cover native; docs say so.
