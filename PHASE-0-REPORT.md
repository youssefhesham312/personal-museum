# Phase 0 — Repository Investigation Report

**Project:** Personal Museum → self-service 3D gift MVP
**Repo:** https://github.com/barisulgen/personal-museum
**Local folder:** `/Users/youssef/Documents/Default Project/personal-museum`
**Commit inspected:** `add634d` — *feat: larger rooms, 3D walls, brighter lighting, UI improvements, bugfixes*
**Date:** 2026-10-26
**Status:** Read-only investigation. **No source files modified.** One new file added: this report.

---

## 1. Current architecture

### Stack

| Layer | Choice | Version |
|---|---|---|
| 3D engine | Three.js (vanilla, no framework) | `three@0.183.0` |
| Bundler | Vite | `vite@7.3.1` |
| Tests | Vitest + fake-indexeddb | `vitest@4.0.18`, `fake-indexeddb@6.2.5` |
| Persistence | IndexedDB via `idb` | `idb@8.0.3` |
| Backend | **None** | — |
| Language | Plain JavaScript (ESM), no TypeScript, no linter | — |

Total application source: **15 JS files, 1,515 lines**. No CI, no deployment config, no `.env` usage, no router.

### Structure

```
index.html                 single page; all menu/loading CSS is inline here
src/main.js                bootstrap: renderer, scene, camera, tour lifecycle, render loop
src/scene/layout.js        pure function: photo count → foyer + zigzag gallery rooms
src/scene/room.js          one room: floor, ceiling, walls split around doorways, baseboards
src/scene/foyer.js         entrance hall: canvas-text title, exhibit info, bench, chandelier
src/scene/frame.js         photo frame (photo plane + mat + 4 molding bars + back panel)
src/scene/lighting.js      ambient, foyer point light, per-frame spotlight
src/scene/museum.js        assembles layout + rooms + frames + lights; reads photos from IndexedDB
src/controls/player.js     FPS controller: pointer lock + WASD + mouse look
src/controls/collision.js  8-direction raycast against wall meshes
src/storage/db.js          IndexedDB store `photos` (blob + name + width/height + addedAt)
src/ui/overlay.js          menu panel: upload, photo count, start, reset, mute
src/ui/upload.js           file input → downscale to 2048px → save blob
src/ui/audio.js            3-track sequential MP3 playlist + mute persistence
public/personal-museum-bg-songs/   3 MP3s, 8.0 MB total
public/textures/           empty (only .gitkeep)
```

### Runtime flow

1. `init()` opens IndexedDB, builds the menu overlay, initialises audio, starts the render loop.
2. Menu is a dark modal over a **blank** canvas (the 3D scene is only built on tour start).
3. **Start the Tour** → hides menu, shows spinner, `await buildMuseum()`, then `requestFullscreen()` + `requestPointerLock()`, `inTour = true`.
4. `buildMuseum()` reads *all* photos from IndexedDB, computes the layout, builds rooms, and places frames.
5. Render loop calls `player.update()` only when `inTour`.
6. ESC (or fullscreen/pointer-lock loss) → `exitTour()` → menu returns; the museum **stays in the scene**.

### Key design characteristics

- **Client-only.** No accounts, no server, no URL state. A museum lives in one browser's IndexedDB.
- **Scene is rebuilt from scratch** on every tour start; the photo source is a hard dependency inside `museum.js`.
- **Layout algorithm** produces foyer + `ceil(n/8)` gallery rooms in a zigzag; 5–15 photos ⇒ **1–2 gallery rooms**. For this MVP's range, museum size is small and predictable.
- **Photo frame placement** happens per wall segment, with two variants: wide walls get 2 standard frames, narrower walls get 1 "feature" frame.
- Tests cover **`computeLayout`** (5 tests) and **IndexedDB photo storage** (5 tests) only. Nothing tests the 3D assembly, controls, or UI.

---

## 2. Reusable functionality (high value)

| Component | Reuse | Notes |
|---|---|---|
| `scene/layout.js` | **As-is** | Pure, deterministic, already unit-tested. Room plan for 5–15 photos is correct. |
| `scene/room.js` | **As-is** | Wall splitting around doorways, baseboards, floor/ceiling. Solid. |
| `scene/frame.js` | **Extend** | Aspect-preserving frame with mat + molding. Needs caption/date placard, texture budgeting, and load/error handling. |
| `scene/lighting.js` | **Tune** | Structure is right; intensities/exposure need a proper look (see §4). |
| `scene/foyer.js` | **Refactor** | The canvas→texture text helper is genuinely reusable for title/dedication/placards. Currently hardcodes copy. |
| `controls/collision.js` | **As-is** | Cheap and effective for axis-aligned wall boxes. |
| `controls/player.js` | **Split** | Desktop half is fine; must be separated from a new touch controller behind one input interface. |
| `storage/db.js` | **Keep + extend** | Good for local drafts and preview. Needs a museum-record store, ordered photos, delete, and reorder. |
| `ui/upload.js` | **Extend** | `processImage` downscale is the right primitive; needs format/quality/size policy and validation. |
| `ui/audio.js` | **Keep, lazy-load** | Playlist + mute persistence work. Must not preload 2.9 MB up front. |
| `scene/museum.js` | **Refactor** | Best single change: accept a config object instead of reading the DB. This unlocks preview, local drafts, and share links from one builder. |
| MP3 assets | Optional | Culturally neutral, royalty status unknown → **replace or drop for launch**. |

**License:** MIT © 2026 Barış Ülgen. Reuse is permitted; the `LICENSE` file and copyright notice must be retained in the derivative product.

---

## 3. Missing functionality (gap analysis vs. the brief)

### Museum experience (Phase 1)

| Requirement | Status |
|---|---|
| Personalized entrance / dedication | ❌ Hardcoded "Welcome to the Personal Museum" + photo count |
| Museum title, recipient name | ❌ Not modelled anywhere |
| Photo captions & dates | ❌ No data fields, no rendering |
| Click/tap photo inspection overlay | ❌ No raycasting, no click/E handling, no overlay |
| Final surprise message | ❌ No end room, no reveal |
| Onboarding instructions | ❌ Only static README text outside the app |
| Loading state | ⚠️ Spinner exists, but it hides **before textures finish loading** → empty frames pop in |
| Error states | ❌ `catch` logs to console and silently reopens the menu; no user-facing message |
| Exit / return-to-entrance | ⚠️ ESC only; no visible exit affordance, no "return to entrance" |
| Mobile controls | ❌ **None.** No touch listeners exist in the codebase at all |
| Photo ordering control | ❌ Insertion order only, from IndexedDB autoincrement |

### Creator experience (Phase 2)

❌ No landing page, no form, no thumbnails, no remove/reorder, no per-file validation messages, no file-size limit, no upload progress, no draft persistence, no design system, no sample museum. The only "form" is a bare `<input type=file>`.

### Persistence & sharing (Phase 3)

❌ No backend, no database, no storage bucket, no slugs, no share URLs, no cross-device access, no expiry, no deletion.

### Safety & operations (Phase 4/5)

❌ No server validation, rate limiting, retention policy, cleanup job, access policies, deployment config, or operational docs.

---

## 4. Mobile usability & performance risks

These are the risks that most affect the product promise ("the recipient opens the link on a phone").

### R1 — Mobile is currently unplayable (critical)

`PlayerController.update()` **early-returns unless pointer lock is held**, and pointer lock is requested only on tour start. Safari on iOS does not support the Pointer Lock API at all; many in-app browsers (Instagram/TikTok/WhatsApp webviews — a primary sharing channel) do not either.

Observed in a headless Chrome run where both `requestFullscreen()` and `requestPointerLock()` were refused:

- the menu is hidden, `inTour` becomes `true`, the museum renders,
- **but there is no way to move and no visible way to exit.** The app is stuck until reload.

Fix in Phase 1: decouple "in tour" from pointer lock, add touch controls, and always render an exit/back affordance.

### R2 — Texture memory can exhaust mobile GPUs

Uploads are downscaled to **2048 px on the long edge** and every photo is a full `MeshStandardMaterial` texture. At 2048×1536 with mipmaps a texture is ≈ 16–17 MB of VRAM. 15 photos ⇒ **~250 MB**, before frames, lights and the framebuffer. Mid-range Android devices will drop the WebGL context.

Fix in Phase 1: budget ~1024–1280 px for framed photos, set `anisotropy` explicitly, dispose textures on teardown, and cap total decoded pixels.

### R3 — Initial payload is heavy for the target market

Measured on the production build:

- JS: **132.4 KB gzip** (Three.js dominates)
- Background music: **2.88 MB fetched on page load** (`preload="auto"` + `loadTrack()` at init) — confirmed via `performance.getEntriesByType('resource')`
- **≈ 3.0 MB before the user does anything**, on a product aimed at Egypt where mobile data is metered.

Fix: lazy-load audio after first interaction, compress to ~96 kbps mono, or ship no default music and let the creator pick a mood later (out of MVP scope → simplest is a small, licensed loop).

### R4 — Lighting reads flat and washed out

`AmbientLight(0xfff5e6, 0.6)` + one `PointLight` per room + a `SpotLight` per frame, ACES tonemapping at exposure 1.0, and shadows **never enabled** (`renderer.shadowMap` is untouched, so all `castShadow = true` flags are inert). Screenshots show near-white walls with no falloff, and a spotlight cone blooming as a flat gradient. Frame borders also render nearly black against the wall.

Fix in Phase 1: drop ambient to ~0.15–0.25, enable a cheap shadow setup (or bake falloff with a gradient/lightmap), add a warm key light at the entrance, and reduce per-frame spotlight intensity. Also add `renderer.shadowMap.type = PCFSoftShadowMap` only if the frame budget allows — otherwise remove the dead `castShadow` flags.

### R5 — Render loop runs when hidden

No `visibilitychange` handling; `requestAnimationFrame` keeps rendering a full scene in a background tab. Battery/data cost on mobile.

### R6 — No focus/scroll safety on mobile

Canvas is `100% / 100%` with `overflow:hidden`. On iOS, `100%` of the *visual* viewport causes the bottom control bar to overlay content when UI is added in Phase 2. Needs `100dvh` + safe-area insets.

### R7 — Unverified (could not test here)

- Real iOS/Android device behaviour.
- Behaviour of the double `exitTour()` path (fullscreen exit and pointer-lock exit both fire and both call `exitTour`).
- The fullscreen transition produced a letterboxed canvas in the headless capture (`getBoundingClientRect` was correct, so this is most likely a capture artifact — needs a real-window check).

---

## 5. Recommended minimal backend & storage

**Recommendation: Supabase (Postgres + Storage) + one small serverless function layer. No accounts.**

Rationale: the brief asks for it, it removes all server-ops work, and it gives us storage + DB + CDN in one dependency. The alternative (a hand-rolled Node API) adds deployment surface with no benefit at this scale.

### Data model (strictly the fields in the brief — no payment/order fields)

```sql
create table museums (
  id              uuid primary key default gen_random_uuid(),
  public_slug     text unique not null,          -- 22-char nanoid, unguessable
  title           text not null,
  recipient_name  text not null,
  dedication      text not null,
  final_message   text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz,                   -- null = retention default applied at read
  delete_token_hash text not null                -- sha256 of a one-time key returned at creation
);

create table museum_photos (
  id          uuid primary key default gen_random_uuid(),
  museum_id   uuid not null references museums(id) on delete cascade,
  position    int  not null,                     -- 0-based display order
  storage_path text not null,
  width       int  not null,
  height      int  not null,
  caption     text,
  date_label  text,
  unique (museum_id, position)
);
```

No `orders`, no `payments`, no `status`, no approval flag.

### Access model

- **Read:** `anon` may `select` museum rows and photo rows **only** (RLS policy `expires_at is null or expires_at > now()`), plus read objects in the `museum-photos` bucket. A share link grants view-only access to exactly one museum — nothing writable.
- **Write:** no `anon` insert/update/delete on either table, ever. All creation/deletion goes through one endpoint that uses the service-role key server-side.
- **Storage paths:** `museums/{museum_uuid}/{nanoid}.webp` — unpredictable, so even a public bucket cannot be enumerated.
- **Drafts are never uploaded.** Photos are uploaded only when "Generate My Museum" is pressed, which satisfies "do not expose draft photo storage publicly by default".
- **Deletion:** the creation response returns a one-time `manage` URL containing the delete token (plaintext only to the creator, stored hashed). Omit accounts entirely.

### Creation flow

1. Client validates locally (count 5–15, JPEG/PNG/WebP, ≤5 MB each), re-encodes to WebP ~1600 px / q0.82 (~200–350 KB each).
2. `POST /api/museums` with metadata → server validates, inserts the museum, returns `slug` + signed upload URLs.
3. Client uploads each optimized photo directly to Storage (per-file progress, retry, partial-failure cleanup).
4. `POST /api/museums/:slug/complete` → server verifies all expected objects exist, writes `museum_photos` rows, marks the museum ready.
5. Client redirects to `/m/:slug` and shows the shareable link.

**Rate limiting:** fixed window in Postgres (`rate_limits` table keyed by SHA-256 of IP + route), 5 creations / hour / IP, 100 uploads / hour / IP. No extra Redis dependency.

**Retention & cleanup:** default `expires_at = created_at + 90 days`, configurable via env. A scheduled job (Supabase `pg_cron` or a daily Vercel cron) deletes expired rows and their storage objects, plus a sweep for museum rows older than 24 h with no photos (abandoned uploads).

**Expiry behaviour:** a warning banner on the museum page in the last 7 days; after expiry the link returns a gentle "this museum has closed" page, not a 404.

**Alternative considered and rejected:** encoding the whole museum into a URL fragment (no backend). 15 optimized photos ≈ 3–5 MB → not shareable. Rejected on product grounds, not taste.

---

## 6. Proposed implementation sequence

### Phase 1 — First-person experience (the bulk of the engineering)

1. **Decouple the builder from storage.** `buildMuseum(museumConfig)` where config = `{ title, recipient, dedication, finalMessage, photos: [{ url, width, height, caption, date }] }`. `main.js` supplies an adapter that reads IndexedDB today and the API in Phase 3. *One change buys preview, drafts and sharing.*
2. **Input abstraction.** `src/controls/input.js` → unified `{ moveVector, lookDelta, interact }`; `DesktopInput` (WASD + pointer lock) and `TouchInput` (left joystick, right-half drag look, interact button). Tour state no longer depends on pointer lock; fullscreen/pointer lock become optional enhancements.
3. **Personalized foyer.** Replace hardcoded copy with title/recipient/dedication plates rendered through the existing canvas-text helper (extracted to `scene/text.js`).
4. **One end-to-end spatial design.** Foyer → 1–2 galleries → final-message alcove with a lit plinth and the dedication's closing line. Keep the existing zigzag layout for 5–15 photos.
5. **Photo inspection.** Raycast from screen centre (desktop) or tap (mobile) against frame userData → overlay with large image, caption, date; freezes movement, restores state on close; ESC/back closes. Reuse blob URLs; no new decoding.
6. **Captions on frames.** Small placard mesh below each frame using the text helper, generated once and disposed with the room.
7. **Texture & memory budget.** Downscale framed textures to 1280 px, `anisotropy = 4`, preload all textures with `LoadingManager` and only then hide the loading screen; hard cap on total pixels; full `dispose()` pass on teardown.
8. **Lighting pass.** Lower ambient, warm entrance key light, `PCFSoftShadowMap` **only if** measured frame time allows, else remove dead shadow flags; tone down spotlight intensity; add a subtle floor reflection-free "polish" via material roughness.
9. **Chrome.** Onboarding card (desktop vs touch copy), crosshair, exit button, pause on `visibilitychange`, error screen with retry, "back to entrance" action.
10. **Tests.** Unit tests for the config-driven builder (photo→slot assignment, caption placement, teardown), the input-state reducer, and the texture-budget function. Keep the 10 existing tests green.

### Phase 2 — Landing + creator

11. Lightweight hash router (`/`, `/create`, `/preview`, `/m/:slug`) — no framework needed.
12. Landing page in the specified palette; embedded playable demo built from bundled sample photos through the same `buildMuseum(config)` path.
13. Creator form: multi-upload (drag/drop + picker), thumbnails, remove, drag-reorder, per-photo caption/date, validation with field-level errors, 5 MB cap, 5–15 count, draft autosave to IndexedDB → `/preview` renders the real museum.

### Phase 3 — Backend + sharing

14. Supabase schema, RLS, bucket, migrations.
15. `POST /api/museums`, signed uploads, `complete`, `GET` read path, `DELETE` with token.
16. Client wiring: real generation, progress, share URL, error handling.
17. Persistence tests across browsers/devices + deletion.

### Phase 4 — Abuse & reliability

18. Server-side validation mirroring client rules, rate limits, safe paths, retention cron, orphan sweep, interruption recovery, access-policy tests.

### Phase 5 — Polish & launch

19. Production build, perf budget, accessibility, real-device matrix, deployment docs, launch report.

---

## 7. Baseline build & test results (actual)

Environment: macOS 26.7 (arm64), Node **v26.7.0**, npm **11.19.0**, git 2.50.1.

```text
$ npm install
added N packages; 9 vulnerabilities (1 low, 1 moderate, 6 high, 1 critical)
   → all in devDependencies; `npm audit --omit=dev` reports 0 vulnerabilities
   → npm warns esbuild/fsevents install scripts are not allow-listed

$ npm test
 ✓ src/scene/layout.test.js (5 tests) 2ms
 ✓ src/storage/db.test.js (5 tests) 6ms
 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  134ms

$ npm run build
 vite v7.3.1 building client environment for production...
 ✓ 19 modules transformed.
 dist/index.html                  4.07 kB │ gzip:   1.42 kB
 dist/assets/index-vwcdWDMl.js  517.56 kB │ gzip: 132.41 kB
 (!) Some chunks are larger than 500 kB after minification.
 ✓ built in 611ms

$ npm run dev        → http://localhost:5199/  OK
$ npm run preview    → http://localhost:5200/  OK (production bundle serves and boots)
```

Runtime checks performed in a Chromium-based browser:

- App boots; **one** console warning: `THREE.Clock is deprecated, use THREE.Timer` (Three r183). No errors.
- Uploaded 6 sample JPEGs (1000×1000 … 1920×1080) → counter showed "6 photos uploaded"; **Start the Tour** enabled.
- Start the Tour built the museum; foyer renders; the doorway into gallery 1 shows two framed photos on the far wall.
- Simulated WASD movement and mouse-look by dispatching events: player advanced and was stopped by the foyer wall (collision works).
- Confirmed 2.88 MB of MP3 is fetched during page load.
- Confirmed fullscreen/pointer-lock refusal leaves the app in an unescapable in-tour state (see R1).

Not verified: real mobile devices, touch input (none exists), Safari/Firefox, the double `exitTour()` path, long-session memory behaviour, the letterboxed canvas observed in headless fullscreen.

---

## 8. Phase 0 acceptance

| Criterion | Result |
|---|---|
| Repository investigated before modification | ✅ |
| Project structure, deps, scripts, entry points documented | ✅ |
| Three.js scene, rooms, lighting, frames, textures, camera analysed | ✅ |
| Photo import, image processing, IndexedDB analysed | ✅ |
| Desktop & mobile movement control assessed | ✅ (desktop works; **no mobile implementation exists**) |
| Tests, build config, deployment, licensing assessed | ✅ (no deployment config; MIT) |
| Dev server, production build, tests run | ✅ all pass |
| No source files modified | ✅ |

**Blocking findings to resolve in Phase 1:** R1 (mobile control/escape), R2 (texture memory), R3 (initial payload), R4 (lighting).

---

## 9. Recommended Git checkpoint

Before Phase 1 begins, create a pristine checkpoint of the upstream baseline so every later change is reviewable:

```bash
cd "/Users/youssef/Documents/Default Project/personal-museum"
git status                 # clean except PHASE-0-REPORT.md (untracked)
git switch -c build/gift-mvp
git add PHASE-0-REPORT.md
git commit -m "docs: add phase 0 repository investigation report"
git tag baseline-upstream add634d
```

Nothing has been committed yet — awaiting your instruction.

---

## 10. Required environment configuration

None for Phase 0. For Phase 3, expect roughly:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-side only, never in the client bundle
MUSEUM_RETENTION_DAYS=90
MAX_PHOTOS=15
MAX_PHOTO_BYTES=5242880
RATE_LIMIT_CREATE_PER_HOUR=5
```

---

## Next phase (not started)

**Phase 1 — First-person museum experience**, per §6 items 1–10: config-driven builder, unified desktop/touch input, personalized foyer, photo inspection overlay, captions/dates, final message alcove, texture/lighting/memory pass, loading & error states, exit control, and tests.

Awaiting explicit approval before writing any source code.
