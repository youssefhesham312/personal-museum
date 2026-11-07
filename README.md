# Personal Museum

A personal 3D virtual photo gallery. Add 5–15 photographs, write a few words for
the entrance hall and the closing alcove, then walk through the museum on a
desktop or phone.

Built with vanilla Three.js and Vite. The local preview is entirely browser-side
(IndexedDB). Optional sharing through Supabase and Cloudflare R2 creates an
unguessable link that opens the same museum on another device and closes after
seven days.

## Features

- **First-person walkthrough** — WASD movement, mouse/drag look, fullscreen immersion
- **Auto-generated rooms** — The museum builds itself from your photographs (share links require 5–15) with connected gallery rooms
- **Grand foyer** — Welcome hall with the museum title, recipient name and dedication
- **Feature walls** — Walls with single large landscape paintings alongside standard gallery arrangements
- **3D photo frames** — Aspect-ratio-preserving frames with a slim walnut molding, warm mat, brass liner and a printed caption card
- **Warm gallery lighting** — A small shared rig (two ceiling lights per gallery, none per photo) keeps rooms readable without a light per frame
- **Photo inspection** — Aim at a frame (or tap it, or use the View button) to read the full photo, caption and date
- **Photo editor** — Per-photo captions and dates, drag or arrow reordering, individual removal
- **Draft autosave** — Details, photos, captions, dates and order survive a reload in the same browser
- **Final message** — A closing alcove with a lit letter panel reveals the surprise message
- **Desktop and touch controls** — Keyboard + mouse, or virtual joystick + touch look + View button
- **Background music** — Sequential multi-track playlist with play/pause and mute (persisted); tracks load on demand
- **Local preview** — Photos stored in IndexedDB, no account or server needed
- **Shareable museum link** — `/m/<22-character-id>`, created only after every photo is verified; expires seven days after creation
- **Private photo delivery** — A private Cloudflare R2 bucket and short-lived presigned URLs, clamped to the museum's remaining lifetime
- **Texture budget** — Photos are downscaled to 1280 px (desktop) or 1024 px (touch devices) before upload to the GPU

## Getting Started

```bash
npm install
npm run dev
```

1. Open the dev server URL in your browser
2. Fill in the museum title, recipient, dedication and closing message
3. Click **Upload Photos** and select 5–15 images (local previews also work with fewer)
4. Click **Start the Tour** to preview the museum locally
5. Click **Create Share Link** to upload the photos and get a link you can send

Sharing is optional. With no `VITE_SUPABASE_*` configuration the local museum
still works; the share button explains that sharing is not configured.

### Enabling share links

1. Create a Supabase project and apply the migrations in `supabase/migrations/`.
2. Create a private Cloudflare R2 bucket and an R2 API token with Object Read &
   Write for that bucket. Configure its CORS policy for your app origins.
3. Deploy the `museum-api` Edge Function and set its Supabase, R2 and museum
   secrets.
4. Copy `.env.example` to `.env.local` and fill in the **public** Supabase project
   URL and anon/publishable key.

The complete walkthrough — R2 variables, exact CORS JSON, extensions, Vault
secrets, hourly cleanup, verification and cost caveats — is in
[`SUPABASE-SETUP.md`](SUPABASE-SETUP.md).

Never put a service-role or secret key in a `VITE_*` variable. Vite inlines
those into the public bundle.

### How sharing works

1. The browser validates the details and photo count, then compresses each photo
   (longest edge 1600 px, WebP with JPEG fallback, 1.5 MB cap).
2. The Edge Function creates a draft, photo metadata and one short-lived R2
   presigned upload URL per photo.
3. The browser uploads the files directly to R2 with progress and retries
   transient failures.
4. Finalization sends a HEAD request for every R2 object and checks the exact
   size and MIME type. Only then is `ready_at` set and the share link usable.
5. A failed upload aborts the draft and its R2 objects. Abandoned drafts are
   removed by the hourly cleanup job after one hour.

Recipients read only finalized, unexpired museums. The cleanup job deletes R2
objects first and database rows second, and the public link starts returning a
friendly "closed" page as soon as the seven days are up — even before cleanup
runs.

### Where the photos live

For the **local preview**, uploads go into this browser's IndexedDB, scoped to the
exact address you are using and to that device. Photos uploaded at
`http://localhost:5173` do not appear at `http://192.168.1.2:5200`, and photos
uploaded on a phone do not appear on a computer. Upload again on the address where
you will walk the museum.

For a **share link**, the optimized copies live in the private Cloudflare R2
bucket and are served through short-lived presigned URLs. R2 credentials stay in
the Supabase Edge Function; the recipient does not need an account or access to
the creator's browser.

JPEG, PNG and WebP are supported. Chrome and Firefox cannot decode Apple HEIC
photos; export them as JPEG first (Safari can open HEIC directly). If a file
cannot be read, the menu says which file was skipped and why, and the rest of the
batch is still added.

### Routes and static hosting

| Path | Purpose |
| --- | --- |
| `/` | Creator and local preview |
| `/m/<22-character-id>` | Shared museum |
| `?demo=1` | Bundled demo museum |
| `?demo=1&photos=15` | Bundled demo at another size (5, 10, 15 are useful) |

`/m/<id>` is resolved by the client, so the host must return `index.html` for
unknown paths. `wrangler.jsonc` sets `not_found_handling: "single-page-application"`
for Cloudflare Workers. A Cloudflare Pages or Netlify deployment instead needs
an equivalent `_redirects` file (`/* /index.html 200`). Share URLs are built as
`<origin>/m/<id>`, so deploy the app at the origin root (not a subdirectory)
unless you also change `buildShareUrl` and the fallback.

`?demo=1` also exposes `window.__museumDebug` (camera, raycast, frame list, build
time) for scripted QA. It is not created on the normal path.

### Deploying to Cloudflare

The current deployment uses **Cloudflare Workers with static assets** through
Workers Builds. Use the repository root, build command `npm run build:deploy`,
deploy command `npx wrangler deploy`, and Node 22. Set only the public
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables. Add the
deployed origin to both the Edge Function and R2 CORS policies.

`wrangler.jsonc` serves `dist/` as static assets with a single-page-app fallback.
Workers rejects a catch-all `_redirects` rule as an infinite loop, so the
fallback lives in the Wrangler configuration instead.

The full runbook, including the exact environment variables, CORS JSON, custom
domain notes and post-deploy checks, is in [`DEPLOYMENT.md`](DEPLOYMENT.md).

### Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Walk | `W` `A` `S` `D` / arrow keys | Virtual joystick (left half of the screen) |
| Look | Mouse (click to capture, or drag) | Drag anywhere on the right half |
| Inspect photo / read message | `E` or click the frame | Tap the frame or the **View** button |
| Close an overlay | `Esc`, ✕ or the backdrop | ✕ or the backdrop |
| Leave the museum | **Leave museum** (top right) | **Leave museum** (top right) |

`Esc` releases the captured mouse; it does not end the tour. Use **Leave museum**
to exit. A small card explains these controls on the first visit; reopen it any
time with the **?** button (bottom left).

## Background Music

Place MP3 files in `public/personal-museum-bg-songs/`. Tracks play sequentially in
a loop.

## Tech Stack

- [Three.js](https://threejs.org/) — 3D rendering
- [idb](https://github.com/jakearchibald/idb) — IndexedDB wrapper for the local preview
- [Vite](https://vitejs.dev/) — Build tool
- [Supabase](https://supabase.com/) — Postgres, one Edge Function, rate limiting and scheduled cleanup
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — private S3-compatible photo storage with presigned URLs
- [Vitest](https://vitest.dev/) — Unit and integration tests

`buildMuseum(config)` remains storage-independent: the scene only consumes an
array of photo URLs and text, whether they come from IndexedDB or R2 presigned
URLs.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build to `dist/` |
| `npm run check:deploy` | Validate the public deployment environment |
| `npm run build:deploy` | Deployment build, refusing placeholder values |
| `npm run preview` | Preview the production build |
| `npm test` | Run all tests (the opt-in live Supabase/R2 test skips without credentials) |
| `npm run test:unit` | Run unit and contract tests only |
| `npm run test:integration` | Run the opt-in live Supabase + R2 test |
| `node scripts/mock-museum-api.mjs` | Start the in-memory mock API for UI work |

## Testing

The automated suite covers the creator flow, photo validation, upload retries,
share-link parsing, expiry rules, R2 SigV4 presigning, object verification,
cleanup orchestration and failures, public-read security contracts, and the
SQL/Edge Function source contract. `npm test` is hermetic; R2 signing is checked
against the published AWS SigV4 test vectors, not a live bucket.

The live Supabase + R2 test is opt-in and is **not** part of the default pass:

```bash
MUSEUM_INTEGRATION_URL=https://<project-ref>.supabase.co \
MUSEUM_INTEGRATION_ANON_KEY=<publishable-or-anon-key> \
npm run test:integration
```

It creates a museum in a development project and leaves it for scheduled cleanup.

For UI work without a Supabase project:

```bash
node scripts/mock-museum-api.mjs
# in another terminal
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_ANON_KEY=local-anon \
npm run dev
```

The mock is an in-memory development tool with no authentication, RLS, real R2
presigned URLs or cleanup. Never deploy it.

## Security notes

- The browser receives only a public anon/publishable key.
- The Supabase service-role key and R2 secret exist only in the Edge Function
  environment.
- Database RLS has no `anon`/`authenticated` policies; all public reads go through
  the function.
- The R2 bucket is private; recipients receive short-lived presigned URLs. The R2
  access key id appears in those URLs, but the secret never does.
- Drafts require a one-time completion token, stored only as a SHA-256 hash.
- Public ids carry 128 bits of randomness and are not sequential.

Do not share photographs you would not want forwarded: anyone with the link can
view the museum until it expires. A shared museum cannot be edited or revoked
early; if you change the details or photos and create a new link, the earlier
link stays viewable until its own seven-day expiry. See
[`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) for the full model.

## License

MIT
