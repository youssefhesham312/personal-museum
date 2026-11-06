# Phase 1B — Gift Experience Polish

Status: **implementation complete, awaiting approval.** No commits were made.
Base commit: `add634d` (upstream). Working tree contains Phase 0/1A/1B changes and the
untracked phase reports.

Phase gate: *the museum feels like a warm, finished gift on desktop, stays usable on a
phone, and never leaves the visitor stuck.* Desktop and synthetic-touch checks pass; real
phone hardware was **not** available (see "Not verified").

---

## 1. What changed

### Lighting rewritten for Three r183
The dim rooms were not a color/tone problem: the original lights used legacy intensities,
while current Three.js uses physical light units. `src/scene/lighting.js` was re-authored
around a **fixed eight-light rig** (15-photo museum):

| Light | Count | Purpose |
| --- | --- | --- |
| Ambient | 1 | warm base wash (0.42) |
| Hemisphere | 1 | soft floor/ceiling separation (0.55) |
| Foyer point | 1 | chandelier pool (60, range 26) |
| Gallery points | 2 per gallery | even ceiling pools (38, range 20) |
| Finale point | 1 | letter/lectern pool (26, range 18) |

- **All per-photo spotlights are gone.** Photographs are readable because each photo plane
  carries a gentle emissive copy of its own texture (`emissiveIntensity: 0.26`), not because
  it is individually lit.
- Light count now scales with gallery count, not photo count.
- Warm tone is consistent across foyer, galleries and finale; the ceiling uses a low cream
  emissive (0.32) instead of reading as a dark slab.
- Brass materials use lower metalness/roughness so they do not go black without an
  environment map.

### Frames and captions
- Slim walnut molding, warm off-white mat, thin brass liner behind the mat.
- Each frame has a printed caption card under it: caption plus date, on paper-colored card.
- Frame proportions and aspect-ratio preservation are unchanged.
- Photos remain readable at walking distance and at close inspection.

### Foyer
- Warm plaster walls and a brighter plank floor with skirting.
- Woven rug, wooden bench, and a brass chandelier (ceiling stem, ring, six candles and
  flames — the old arms read as sticks and were removed).
- Title, recipient, dedication and photo count repositioned and rescaled so all are legible
  from the entry point; the count label is larger.

### Finale
- Panel reduced to 4.8 × 3.25 m at `panelY = height * 0.43`, with a brass rim and backing
  board, so it fits the alcove instead of filling it.
- Wooden reading lectern with a sloped desk and a small warm lamp.
- One repositioned point light between panel and lectern.

### Click behavior after Escape
- New pure helper `src/core/clickAction.js`: a canvas click returns `inspect` whenever a
  target is under the reticle, otherwise `capture` when Pointer Lock is available, else
  `none`.
- `desktopInput.js` uses it, so the first click after `Esc` **inspects the frame in view**
  instead of silently re-capturing the mouse.
- Six unit tests cover every branch.

### Onboarding and HUD states
- Non-blocking **How to explore** card on first entry, with separate desktop and touch rows.
- Dismissed by movement, joystick gesture, outside mouse click, ✕ or "Begin exploring";
  the dismissed state persists in `localStorage["museum-controls-seen"]`.
- Persistent **?** button reopens the card at any time.
- Target label under the reticle ("View photograph" / "Read the message") and a View/Read
  button on touch.
- Closing a photo overlay restores the controls hint.
- The card is informational only: it never blocks walking or inspection.

### Loading and recovery
- Visible **Cancel** while a museum is building; it returns to the menu immediately.
- Builds use an `AbortController` plus a build token: stale builds are discarded and their
  geometries/materials/textures disposed, so cancelling and restarting at once works.
- Build failures show a readable error with **Try again** and **Back to menu**, and leave
  input disabled rather than half-enabled.

### Preserved from 1A
- `buildMuseum(config)` remains storage-free; only `museumSource.js` touches IndexedDB.
- Photo texture budget unchanged: 1280 px desktop / 1024 px touch, three at a time,
  disposed on exit/rebuild.
- All three music tracks preserved; `preload="none"`, `src` set on first play, lazy load.
- Pointer Lock remains a progressive enhancement; drag-look works without it.

---

## 2. Files

**New**
| File | Purpose |
| --- | --- |
| `src/core/clickAction.js` | Pure click decision (`inspect` / `capture` / `none`) |
| `src/core/clickAction.test.js` | Six branch tests |
| `src/scene/frame.test.js` | Photo UV flip and portrait/landscape frame sizing |
| `src/ui/upload.test.js` | HEIC detection, failure wording, partial/empty batch summaries |

**Modified**
`src/scene/lighting.js` (rewritten rig), `src/scene/room.js` (plaster, floor, ceiling
emissive, skirting), `src/scene/frame.js` (molding/mat/brass liner, emissive photo, caption
card, upright photo UVs), `src/scene/foyer.js` (chandelier, rug, bench, text/count layout),
`src/scene/finale.js` (panel size/position, brass rim, lectern + lamp, light),
`src/scene/museum.js` (shared light wiring, abort signal, frame sized from decoded texture,
all-textures-failed error), `src/scene/textures.js` (browser-consistent decode, EXIF-safe
dimensions), `src/ui/upload.js` (per-file upload failures, oriented dimensions),
`src/ui/overlay.js` (upload status line, Start locked while adding), `src/main.js` (build
tokens, Cancel, target labels, hint restore, QA hooks), `src/controls/desktopInput.js`
(inspect-first clicks), `src/ui/hud.js` + `src/ui/ui.css` (controls card, help, target label,
loading cancel styles), `index.html` (loading actions, upload status styles), `README.md`
(features, controls, fixtures, storage scope, HEIC note).

---

## 3. Performance (measured before optimizing)

Environment: desktop Chromium preview pane, macOS, Apple M4 (ANGLE/Metal), 15-photo museum,
1600×1310 render buffer. The pane throttles `requestAnimationFrame`, so timings use explicit
draws with `gl.finish()` / `EXT_disjoint_timer_query_webgl2`, not FPS.

| Setup | Frame cost (repeated runs) |
| --- | --- |
| Before: 16 per-photo spotlights | 17.1 / 28.7 / 34.1 ms |
| Before: same view, 2 lights visible | 4.5 / 3.6 / 4.4 ms |
| After: fixed rig, 8 lights, 0 spotlights | medians 1.4–9.6 ms across runs |

The absolute numbers drift between runs in this pane (same view, back-to-back medians
6.83 ms then 9.62 ms). The reliable result is the order of magnitude: removing per-photo
spotlights moved the 15-photo scene from tens of milliseconds per frame into single digits.

Current scene budget for 15 photos: **8 lights** (1 ambient, 1 hemisphere, 6 point),
0 spotlights, 15–22 draw calls in the tested views (frustum-culled), build time ~69–93 ms on
a warm dev server (81 ms after the photo-decode fix). Texture decoding stays capped at three
at a time and is disposed on exit; 5-photo builds measured 39–48 ms this pass.

---

## 4. Automated verification (actually run)

```
npm test
  Test Files  14 passed (14)
       Tests  103 passed (103)

npm run build
  ✓ 38 modules transformed.
  dist/index.html                   4.88 kB │ gzip:   1.62 kB
  dist/assets/index-ZcIOG-qQ.css    9.96 kB │ gzip:   2.64 kB
  dist/assets/index-DyfjlwWs.js   556.11 kB │ gzip: 146.08 kB
  ✓ built in 617ms
```

The >500 kB warning is Three.js, as before. New tests are the six `clickAction` cases,
four `frame` cases (UV flip, portrait/landscape sizing) and seven `upload` cases (HEIC
detection, failure wording, partial/empty batch summaries); all 86 Phase 1A tests still pass.

---

## 5. Browser checks (performed)

Chromium in the desktop preview pane, synthetic PointerEvents for touch. Canvas frames were
captured with `canvas.toDataURL` because the pane's screenshot path returns stale frames.

| Check | Result |
| --- | --- |
| Foyer: title, "for Noor", dedication, "15 photographs" readable; warm walls/floor, rug, bench, chandelier visible | Pass |
| Gallery: frame shows walnut molding, cream mat, brass liner, caption card with date | Pass |
| Finale: panel fits the alcove, letter readable, lectern + lamp visible | Pass |
| 5 photos: 5 frames (indices 0–4) + finale; last opens "5 / 5", correct caption/date | Pass |
| 10 photos: 10 frames (indices 0–9) + finale | Pass |
| 15 photos: 15 frames (indices 0–14) + finale; build 69–93 ms | Pass |
| `E` opens overlay; `Esc` closes it, returns to `exploring`, restores hint | Pass |
| Click immediately after `Esc` with a frame in view opens the overlay (no re-capture) | Pass |
| Backdrop click closes overlay | Pass |
| Leave museum → state `idle`, menu returns; restart rebuilds 5 frames | Pass |
| Finale target reads "Read the message"; opens "For Noor" + full letter | Pass |
| First visit shows controls card; desktop rows correct | Pass |
| Touch rows: joystick / drag / View / ✕ | Pass |
| First touch joystick gesture hides card and persists `museum-controls-seen=1` | Pass |
| Touch joystick 40 frames → 2.0 m forward, stops on release, joystick hidden | Pass |
| Touch drag 140 px → yaw −0.63 rad | Pass |
| Touch View button opens "5 / 10" and closes cleanly | Pass |
| **?** button opens and closes the controls card | Pass |
| Mute toggles `aria-pressed`, label and `localStorage["museum-muted"]` | Pass |
| Audio lazy: 0 MP3 requests on load | Pass |
| Loading Cancel returns to the menu; immediate restart rebuilds | Pass (earlier pass) |
| 8 lights / 0 spotlights for the 15-photo museum | Pass |
| Upload 4 real files (4032×3024 JPEG, two 1000×750 JPEGs, one HEIC): 3 saved, HEIC named in the menu with a JPEG-export hint | Pass |
| 4032×3024 photo stored at 2048×1536 after upload | Pass |
| 3-photo museum built from those uploads: foyer reads "3 photographs", no build error | Pass |
| Client's stored 676×1280 JPEG and 716×686 PNG: museum builds 2 frames, both maps attached; in-museum render upright and uncropped | Pass (read-only from the LAN origin) |
| HEIC selected alone reports "Nothing was added" instead of failing silently | Pass (dev console showed the per-file warning) |

Issues found and fixed while polishing:

1. Rooms were dark because legacy light intensities were used under r183 physical units.
2. 16 per-photo spotlights dominated frame time; replaced with the shared rig + emissive photos.
3. First click after `Esc` re-captured the mouse instead of inspecting.
4. Brass went black without an environment map; metalness/roughness reduced.
5. Ceiling read as a dark slab; low cream emissive added.
6. Chandelier arms read as sticks; replaced with a ring and candles.
7. Foyer count label was too small; rescaled.
8. Loading had no way out; Cancel + abort tokens added.

---

## 6. Post-phone-test fix — upside-down and cropped photos

A real-phone pass surfaced two defects that the gradient demo images had hidden:

1. **Every photo rendered upside down.** Photo textures come from `ImageBitmap`
   (`createImageBitmap`) and WebGL ignores `UNPACK_FLIP_Y_WEBGL` for that source, so
   Three.js's default `flipY = true` was silently doing nothing. The HTMLImage fallback
   looked correct, which is why the demo images never exposed it.
2. **Some photos looked stretched or cropped.** Stored width/height could disagree with the
   decoded image (notably EXIF-rotated phone photos, and any browser that treats the
   `createImageBitmap` resize options differently), while the frame geometry was built from
   the stored numbers. The texture itself was always complete; the frame opening was simply
   the wrong shape.

Fixes:
- Photo textures now set `flipY = false`, and the photo plane flips its own V coordinates
  (`flipVerticalUvs` in `frame.js`). This is browser-independent: it works whether the
  driver honours the upload flag or ignores it, and keeps `map`/`emissiveMap` aligned.
- Both upload (`ui/upload.js`) and scene loading (`scene/textures.js`) decode through an
  `<img>`, so EXIF orientation and the reported dimensions match what the browser displays.
- The frame is sized from the **decoded texture's** dimensions (`museum.js`), never from
  metadata alone, so rotation or resampling can no longer change the frame's aspect.
- Uploaded images over 2048 px are still baked to JPEG at 2048 on the long edge, using the
  same oriented dimensions.

Verification: marked portrait (600×1200), landscape (1200×600) and panorama (1600×500)
images render upright and complete inside their frames; an EXIF orientation 6 JPEG is stored
at 200×400 (oriented) and a 3000×2000 version is stored at 1365×2048; a real portrait
screenshot from IndexedDB (574×896) renders full in a 2.28×3.35 frame. Four new
`frame.test.js` cases cover the UV flip and portrait/landscape sizing.

---

## 7. Upload feedback fix — real photos that never appeared

After the phone pass, the client reported uploading real photos that did not appear in the
museum. Reproduction in Chromium found a silent failure in the upload path:

1. **One unreadable file aborted the whole batch.** `handleUpload` had no per-file error
   handling. A file the browser could not decode — most commonly an iPhone HEIC photo in
   Chrome or Firefox — rejected the promise before `getPhotoCount()` ran. The menu kept its
   previous count, every file after the bad one was skipped, and nothing explained why. If an
   older photo was already stored, the tour opened with only that photo, which looks exactly
   like "uploaded but not shown in museum."
2. **All-failed museums opened as blank frames.** A failed texture decode was only a console
   warning, so a museum built entirely from undecodable photos still "succeeded" with empty
   frames.

Fixes:
- `ui/upload.js` now processes files independently, saves the readable ones, collects
  `{ name, reason }` for the rest, and always returns the fresh photo count.
- `buildUploadSummary` produces a plain-language line ("3 added, 1 skipped (IMG_1.HEIC)…
  iPhone HEIC photos need to be exported as JPEG first"), and HEIC/HEIF is named explicitly
  instead of blaming the file. Quota and storage failures get their own wording.
- The menu shows that line under the count (`aria-live="polite"`), and **Start the Tour** is
  disabled while a batch is being processed, so a half-added batch cannot be opened.
- `scene/museum.js` throws "None of the photographs could be opened by this browser" when
  every texture fails, so the loading screen explains it instead of showing empty frames.
- README now states that uploads are scoped to one browser **and one address** (localhost vs
  LAN vs phone do not share photos), and that HEIC needs exporting for Chrome/Firefox.

Verified in Chromium with a mixed batch: 4032×3024 JPEG + two 1000×750 JPEGs + one HEIC →
3 added, 1 skipped, HEIC named, count 3, Start enabled; the 4032×3024 file was stored at
2048×1536 and the resulting museum read "3 photographs". A HEIC-only batch reports
"Nothing was added", leaves Start disabled, and logs one warning. Seven new `upload` tests
cover the wording paths.

The two photos already stored at the LAN origin were then inspected read-only: a 676×1280
portrait JPEG and a 716×686 PNG. Both decode, the museum builds two frames with both maps
attached (541×1024 and 716×686 after the texture budget), and a render from inside the built
museum shows the portrait upright and uncropped. The stored photos are therefore not the
blocker. The remaining explanations are the address/device scoping above, or a tab still
running the pre-fix bundle.

Caveat: the client's exact upload address and device were not captured. HEIC is a reproduced
silent failure, but it is not what their two stored photos are; those are JPEG/PNG and now
render. The menu now states what happened for any future batch, and the README spells out the
storage scoping.

---

## 8. Not verified / limits

- **Real iOS/Android hardware.** The client ran one real-phone pass (phone model and OS not
  recorded) and reported the controls, audio and rooms working, but photos arrived upside down
  or cropped and a later real-photo upload did not appear. Those defects were fixed and await
  the next phone pass. That is the client's report, not an independent device test by me: I did
  not operate a physical phone or inspect its console. Still unverified on hardware:
  joystick feel, safe-area insets, iOS Safari gesture/fullscreen behavior, autoplay policy,
  thermal/GPU limits, and real mobile GPU cost.
- **Uploads on a real phone.** Mixed batches and HEIC handling were verified in desktop
  Chromium only. iOS Safari decoding HEIC inside the museum is untested.
- **Storage scoping.** IndexedDB is per browser profile and per address. The client's two
  photos were found at the LAN origin and render correctly there; a different address, a
  different browser profile or a phone has a separate store.
- **Phone-width visual layout.** The client's real-phone pass is the only evidence that the
  HUD and controls card fit a phone screen. The preview pane still cannot set a mobile
  viewport, so I could not re-check the layout myself.
- **Pointer Lock branch.** The pane never grants a real lock. The "locked" and "capture"
  paths are covered by unit tests, not by hardware behavior.
- **Audio playback.** No user gesture was available for reliable playback/autoplay-refusal
  testing; mute persistence and zero-load requests were verified.
- **Absolute timing.** GPU/CPU timings vary between runs and are specific to this machine
  and browser; treat them as relative evidence, not a phone benchmark.
- **Photo content.** Demo images are all 1000×750 generated JPEGs, so the portrait/orientation
  regressions only showed up with real phone photos; the fixes were then re-checked with
  marked portrait, landscape, panorama and EXIF-rotated fixtures.

---

## 9. Scope compliance

No backend, database, landing page, creator form, share links, accounts, payments or Phase 2
work was added. Three.js + Vite architecture, all music tracks, lazy audio, texture limits
and disposal behavior are preserved. No new runtime dependencies. The upstream MIT license is
untouched. No commits were made.

**Stopping here for approval before Phase 2.**
