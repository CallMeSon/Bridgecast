# Plan: apply the Bridgecast .pen design to the app, and add minimal motion

Date: 2026-11-06. Source of truth for the visuals: `Bridgecast.pen` (Design System frame and the Console, Home, Dialog and Prepare frames). Rules: `DESIGN.md` (updated 2026-11-06 for tag colours). Motion rules: the taste skill's app-screen section (`references/app-screens.md` §"no motion floor": motion is feedback, not entrance) plus `references/motion.md` for timing and reduced motion. Where taste's web-page rules (1px rules banned, entrance stagger) conflict with DESIGN.md, DESIGN.md wins for the console.

## 0. Already decided (do not reopen)

- Tag colours: LIVE and NEXT use the accent; FROZEN is blue (`--tag-frozen`), BLACK is Text fill, KV is violet (`--tag-kv`). The "One State Colour" rule is replaced by the "Tag Colour" rule. Applied in `tokens.css`, `app.css` (`.stag` rules) and `DESIGN.md`. Still to verify in the running app with real state.
- Neutral selected states: current deck row, header Home button, Home grid/list toggle, pressed hold buttons are neutral (Raised High or Panel with a Line High ring). Only on-air and next use the accent.
- Dark palette stays on Tuning B. Do not retune.
- Keep existing motion: switch knob 0.15s, section chevron 0.18s, event card ring 0.18s. Slide contract: Cut 50ms, Fade 250ms, never a black frame, never show before decoded.

## 1. Gaps between the .pen and the app (to apply)

| Area | .pen | App now | Work |
| --- | --- | --- | --- |
| Right panel tabs | Controls, Output, Info (left to right) | Info, Controls; Output and Network sit inside Controls | Add an Output tab; move Output and Network into it; order Controls, Output, Info. Keep Up next in Output too (as in .pen). |
| Tags | six state tags with the new colours | new colours in CSS; Home and deck-row tags use the same `.stag` | Verify in the running app: deck rows, Home on-air banner, event tab, Program head, strip thumbnails. |
| Home | centred hero, neutral toggle, neutral Home button | hero done; toggle and Home button done in the .pen only | Check `Segmented.tsx` / `.hero` / header button in the app. |
| Deck row current | neutral Raised High | accent tint (`--accent-soft`) | Change `.deck-row` current state to neutral. Keep LIVE tag as the on-air mark. |
| Sidebar components | Sidebar / Controls, Output, Info | not componentised | Not an app task. Frames only. |
| Frozen and Web live sidebars | not yet instances in the .pen | Preview and Web-page Up next | Design question (section 3). |
| Hex leftovers in .pen | Standby and Black cards, overlays, a few greys | — | Design question (section 3). |

Implementation order:
1. Tokens and tags: verify `.stag` colours in the running app (`npm run dev` on Linux, with xvfb screenshots via the e2e launch args). Check contrast of text on each tag in light and dark, and record the numbers.
2. Deck row current state to neutral. Check the Home toggle and header Home button against the .pen.
3. Right panel: add the Output tab, move Output and Network into it, reorder to Controls, Output, Info. Update `panel-sections.ts` and its test, and any e2e that clicks the Controls tab (`e2e/settings.mjs`, `e2e/web.mjs`, `e2e/layout.mjs`, check with grep first).
4. Screenshot the console in light and dark, at 1440 and 1024 widths, and compare with the .pen frames.
5. Run `npm run typecheck`, `npm test`, the relevant e2e suites (`test:e2e:layout`, `test:e2e:settings`), and `npm run lint` (do not add new lint errors).

Do not touch: keyboard map, clicker, terms and tally words, "never black, never desktop", output and Prepare windows, English copy.

## 2. Motion plan (feedback only, no entrances)

Principles: transform and opacity only, 120–200ms, ease-out `cubic-bezier(.16,1,.3,1)`, no bounce. Every move has a reduced-motion path. The app already has a "Reduce motion" setting in Appearance; wire the new motion to it and to `prefers-reduced-motion`. Reduced motion keeps colour and state changes (instant or 80ms opacity) and drops travel and scale.

Proposed moves, in priority order:

1. **Going live (the one protected moment):** the monitor ring and the LIVE tag cross-fade to the accent over 180ms when a take goes on air. The slide itself keeps its Cut or Fade contract and is not delayed or animated by this.
2. **Tab indicator glide:** the 2px underline of the right panel tabs (Controls, Output, Info) slides to the selected tab over 180ms instead of jumping.
3. **Segmented thumb glide:** the grid and list toggle and other segmented controls (Home filter) slide their selected background over 150ms.
4. **Press feedback:** buttons and hold buttons scale to 0.98 on `:active` over 80ms; hold buttons change fill over 120ms.
5. **Hover and focus:** rows, deck rows and event cards change background over 120ms; focus ring appears instantly (no fade, for keyboard users).
6. **Dialog and menu open:** scrim fades and the dialog rises 8px with opacity over 180ms; menus open from the click point with scale 0.98 to 1 over 150ms. Close is 120ms.
7. **Toast (Black undo):** slides up 12px and fades over 180ms, leaves over 120ms.
8. **Strip thumbnails:** the on-air ring fades over 150ms when the take moves.

Existing motion stays as it is (switch knob 0.15s, section chevron 0.18s, event card ring 0.18s).

Not planned: entrance animations on console panels or lists, staggered reveals, looping motion, anything on the Program output itself beyond the existing slide contract, and layout-property animation (height, width, top).

Test: a unit test for the reduced-motion decision helper if one is added; e2e checks only where the layout is measured. Visual check with screenshots in both themes.

## 3. Decisions

- Answered: Network moves into the Output tab (as in the .pen). Controls holds Up next, Transition and Deck settings.
- Answered: motion is feedback only, no entrance animations (section 2).

Answers received after that:

- Frozen and Web live sidebars: done in the .pen as components `Sidebar / Frozen` (`OVtrx`) and `Sidebar / Web` (`aXKHF`), instanced in the Frozen Light and Dark frames and the Web live Light and Dark frames.
- Standby Dark frame: skipped; it is not in the app.
- Storyboard tour: build it in the app as a first-run overlay (shown on first launch after install). Source: App Tour storyboard frames in the .pen (`iFj9y`, and the full storyboard). The tooltip copy in the full storyboard was written by the model, so the user should check it before the overlay ships. Needs its own plan in the new session.

Not answered, default taken:

- Hex leftovers in the .pen (Standby and Black card colours, overlays such as `#ffffff8c`): console frames are already tokenised. Remaining hex stays where it is (overlays, swatches). Change this if you want those converted too.

## 4. Done when

- The app matches the .pen for the console, Home and dialogs, in light and dark, at 1440 and 1024 widths, checked by screenshot.
- Tags, neutral states and the Output tab are in place, with the tests and e2e suites above passing.
- Motion list in section 2 is in place, with reduced motion handled, and the existing motion is unchanged.
- `DESIGN.md` matches what was built. Any new token is in `tokens.css` and in the `.pen` variables.
