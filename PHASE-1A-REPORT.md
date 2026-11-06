# Phase 1A — Reliable Museum Engine

Status: **implementation complete, awaiting approval.** No commits were made.
Base commit: `add634d` (upstream). Working tree contains all Phase 1A changes plus the
untracked `PHASE-0-REPORT.md` from the previous step.

Gate for this phase: *the existing sample museum works on desktop and real mobile
devices without storage-dependent rendering.* Desktop and storage independence are
verified below; real-device mobile is **not** verified (see "Not verified").

---

## 1. What was built

### Engine is now config-driven and storage-free
- `buildMuseum(config, options)` returns `{ group, collisionMeshes, interactables, config, dispose }`.
- It reads no storage: no `idb`, no `getAllPhotos`, no backend. Everything comes from the
  normalized config.
- `src/core/museumConfig.js` normalizes/validates title, recipient, dedication, final message
  and the ordered photo list (url, width, height, caption, date). Missing photo URLs are
  dropped, dimensions are clamped, text is trimmed/truncated and line breaks in block text
  are preserved.
- `src/storage/museumSource.js` is the only storage-aware adapter: it turns IndexedDB blobs
  into object URLs and a plain config, and revokes the URLs afterwards.
- Rebuilding or exiting disposes the whole museum instead of leaving it resident.

### Layout additions
- The existing layout algorithm is untouched by default. `computeLayout(count, { finale: true })`
  appends a closing alcove after the last gallery, so all 10 upstream layout tests still run
  against the original behaviour.
- Existing capacity (8 photos per room), feature walls, doorway placement and room positions
  are preserved. Frame placement rules were extracted to `src/scene/placement.js` so they can
  be unit tested.
- Upstream bug fixed: foyer walls were never added to the collision set.

### Controls
- **Desktop** (`src/controls/desktopInput.js`): WASD/arrows, mouse look, wall sliding,
  `E` or click to inspect, click-to-capture pointer lock, drag-look fallback when Pointer
  Lock is unavailable, Escape only releases the mouse (it no longer ends the tour).
- **Touch** (`src/controls/touchInput.js` + `src/controls/joystick.js`): floating joystick on
  the left half, drag-look on the right half, dedicated View button; Pointer Events with
  `pointercancel`/`pointerleave`/blur/orientation-change resets; no Pointer Lock dependency.
- Shared, unit-tested math: `look.js`, `movement.js`, `joystick.js`.
- `PlayerController` only integrates look/movement; input sources push values into it.
- A visible **Leave museum** button exists on both platforms. Camera movement is blocked
  while an overlay is open (`tourState.js`), and inputs are disabled/re-enabled around it.

### Interactions
- Foyer inscription: museum title, recipient, dedication and photo count.
- Photo frames: reticle raycast (walls occlude) → photo overlay with full image, caption,
  date and position ("3 / 15"). Close with ✕, backdrop, or Escape.
- Finale alcove: a lit letter panel that opens the personalized closing message in a
  paper-styled overlay.

### Textures and resources
- Photo textures are decoded with `createImageBitmap` and resized **before** upload:
  1280 px longest edge on desktop, 1024 px on coarse-pointer/small screens (`scene/textures.js`).
- Loaded three at a time (`mapWithConcurrency`), never all at once.
- Canvas fallback path also downscales, so the pixel budget holds when
  `createImageBitmap` is unavailable.
- `dispose()` releases geometries, materials and all maps, closes `ImageBitmap`s, detaches
  the group, and is called on exit, rebuild, and partial build failure.

### Audio (preserved, made lazy)
- Same three tracks, same sequential playlist, same `museum-muted` persistence, same
  play/pause and mute controls (menu and in-tour HUD).
- `preload="none"` and `src` is only set on first play, so no MP3 is fetched on initial load.
- Autoplay refusal is handled: playback stays paused, UI reflects it, and the visitor can
  press play.

---

## 2. Files

**New**
| File | Purpose |
| --- | --- |
| `src/core/museumConfig.js` | Config normalization/validation |
| `src/core/concurrency.js` | Bounded-concurrency map |
| `src/core/tourState.js` | idle / exploring / inspecting state machine |
| `src/scene/placement.js` | Frame-per-wall planning (extracted) |
| `src/scene/finale.js` | Final-message alcove |
| `src/scene/text.js` | Canvas text plates |
| `src/scene/textures.js` | Texture budget, decoding, disposal helper |
| `src/interaction/pick.js` | Reticle raycast + `findInteraction` |
| `src/controls/look.js`, `movement.js`, `joystick.js` | Shared, testable input math |
| `src/controls/desktopInput.js`, `touchInput.js` | Platform input |
| `src/ui/hud.js`, `inspectOverlay.js`, `ui.css` | In-tour HUD, overlays, styles |
| `src/storage/museumSource.js` | Storage → config adapter |
| `src/demo/sampleMuseum.js`, `public/demo/photo-1..6.jpg` | Storage-free demo fixture |
| `*.test.js` (8 new files) | See section 3 |

**Modified**
`src/main.js` (rewritten lifecycle/wiring), `src/scene/museum.js` (config-driven build + disposer),
`src/scene/layout.js` (optional finale), `src/scene/foyer.js` (personalized text),
`src/scene/frame.js` (texture/metadata/indices), `src/controls/player.js` (camera rig only),
`src/ui/overlay.js` (start flow, audio controls), `src/ui/audio.js` (lazy tracks),
`index.html` (error/actions markup, `preload=none`, `touch-action`), `README.md`,
`src/scene/layout.test.js` (appended finale suite; original tests untouched).

---

## 3. Automated verification (actually run)

```
npm test
  Test Files  11 passed (11)
       Tests  86 passed (86)
```

All 10 upstream test files still pass. New coverage:

- `core/museumConfig.test.js` — defaults, whitespace, paragraphs, photo order/metadata,
  invalid URLs, bad dimensions, truncation.
- `core/concurrency.test.js` — order, in-flight limit, empty input, error propagation.
- `core/tourState.test.js` — enter/inspect/dismiss/leave, no double overlay, movement gating.
- `controls/look.test.js`, `movement.test.js`, `joystick.test.js` — pitch clamp, yaw wrap,
  diagonal speed, wall sliding, joystick normalization/clamping/release/cancel.
- `interaction/pick.test.js` — parent walk, malformed data, cyclic guard.
- `scene/placement.test.js` — wall capacity, slot limits, and full-museum frame placement for
  5/10/15 photos.
- `scene/textures.test.js` — resize math (landscape/portrait/no-upscale/bad input) and the
  desktop/mobile budget choice.
- `scene/layout.test.js` — appended finale suite (position after galleries, one doorway,
  no overlap at 5/10/15/40 photos).

```
npm run build
  ✓ 37 modules transformed.
  dist/index.html                   4.40 kB │ gzip:   1.52 kB
  dist/assets/index-DxH8GAvp.css    6.77 kB │ gzip:   2.07 kB
  dist/assets/index-BUkK8ala.js   543.32 kB │ gzip: 141.45 kB
  ✓ built in 779ms
```

The >500 kB chunk warning is Three.js and predates this phase.

---

## 4. Manual browser checks (performed)

Chromium in the desktop preview pane, macOS. Page size 800×655 CSS @ DPR 2.

| Check | Result |
| --- | --- |
| `?demo=1` loads with no console errors | Pass (only the expected "fullscreen requires a gesture" warning) |
| Foyer title, recipient, dedication, photo count visible | Pass (after repositioning) |
| Wall collision + doorway navigation | Pass |
| Reticle acquires a frame; HUD enters `has-target` | Pass |
| `E` opens photo overlay: "1 / 6", caption, "March 2021", 1000×750 image | Pass |
| Camera frozen while overlay open (held W 30 frames) | Pass (position unchanged) |
| Escape closes overlay, clears the image, returns to exploring | Pass |
| Finale panel target + `Read`; letter overlay shows title, "For Noor", full message | Pass |
| Letter overlay hides the image area | Pass (after fix) |
| Touch joystick: 40 frames forward → 2.0 m, stops on release, no drift | Pass (synthetic PointerEvents) |
| Touch drag-look: 100 px right → yaw −0.45 rad; movement follows new heading | Pass |
| `pointercancel` resets joystick without residual movement | Pass |
| Touch View button opens the photo overlay | Pass |
| Leave museum: state idle, HUD hidden, menu returns, scene disposed (0 interactables) | Pass (after fix) |
| Start again after exit rebuilds the museum | Pass |
| 5 / 10 / 15 photos: 5/10/15 frames with indices 0..n-1, plus finale | Pass |
| 15-photo museum: last frame opens as "15 / 15" with correct caption | Pass |
| Build time (dev server, textures warm): 5 → 32 ms, 10 → 56 ms, 15 → 61 ms | Informational |
| Real storage path (6 photos already in IndexedDB): builds and renders, no errors | Pass |
| Audio lazy: menu has `src=null`, `preload=none`, 0 MP3 requests | Pass |
| Mute toggles element + `aria-pressed` + `localStorage["museum-muted"]` | Pass |
| Play/pause toggles the audio element | Pass |

Bugs found and fixed during these checks:

1. `hud.hide()` threw `ReferenceError: hideJoystick is not defined`, so **Leave museum**
   silently failed. Fixed by hoisting the joystick helpers.
2. `[hidden]` was overridden by `display:flex` on `.inspect-media`, so the letter overlay
   showed a broken image. Fixed with an explicit `[hidden] { display:none }` rule.
3. Foyer title/dedication sat too high (title off-screen). Repositioned.
4. Spurious "Mouse released" hint when the browser refused the initial lock. Now only shown
   after a lock the visitor actually had.
5. `setPointerCapture` throws for synthetic/already-released pointers. Guarded.

---

## 5. Not verified

- **Real iOS/Android devices.** Not available. Everything touch-related was checked with
  synthetic PointerEvents in desktop Chromium plus CSS review. Unverified on hardware:
  joystick feel, safe-area insets, iOS Safari gesture/fullscreen behaviour, autoplay policy,
  thermal/GPU limits.
- **Narrow/touch layout visually.** The preview pane cannot emulate a device or set a
  viewport, so the mobile HUD spacing was not seen at phone width.
- **Frame rate.** The pane throttles `requestAnimationFrame` when unfocused (0–2 frames per
  second on demand), so any FPS number would be meaningless. 15 photos = 15 frame spotlights
  + a point light per room; this remains the main mobile performance risk.
- **Autoplay refusal branch.** Playback started in every run, so the blocked path
  (`state.blocked`, "▶ Play Music") was only code-reviewed.
- The preview capture shows a black band at the bottom; DOM measurements (canvas rect
  800×655, buffer 1600×1310, viewport 0,0,1600,1310) confirm it is a capture artifact, not a
  layout bug.

---

## 6. Risks / deferred

- Photo frames still render dim under the existing spotlight rig — visual work is Phase 1B.
- Per-frame spotlights scale linearly with photo count (15 at the top end).
- After Escape releases the mouse, the next click re-captures it instead of inspecting; `E`
  works, and the hint says so.
- The finale panel is large at close range and the lectern reads as a black box up close.
- Demo photos are generated gradients and `?photos=N` repeats them; they exist only to
  exercise the engine before the creator flow lands.
- `?demo=1` (and `?photos=N`) expose `window.__museumDebug` for scripted QA. It is not
  created on the normal path.

## 7. Scope compliance

No backend, Supabase, migrations, landing page, creator form, sharing, payments, accounts or
Phase 1B visual redesign were added. Upstream MIT license and copyright are untouched. No
commits were made.

**Stopping here for approval before Phase 1B.**
