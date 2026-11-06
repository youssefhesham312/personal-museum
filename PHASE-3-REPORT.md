# Phase 3 — Sharing, Persistence and Seven-Day Retention

Status: **implementation complete with Cloudflare R2 photo storage, awaiting
approval.** No commits were made. Base commit: `add634d` (upstream). The working
tree contains Phase 0/1A/1B/3 changes and the untracked phase reports.

Phase gate: *a creator can build a museum, publish it through a trusted backend,
send one unguessable link that works on another device, and have the museum and
its photos disappear automatically after seven days — without exposing privileged
credentials or allowing public edits.*

The creator flow, mock-backed UI checks, automated tests and production build
pass. **Neither a live Supabase project nor a live R2 bucket has been used**:
there is no project, CLI or bucket in this environment. See
[§8](#8-not-verified--limits).

### Revision — R2 replaces Supabase Storage (2026-10-28)

Photo bytes now live in a private Cloudflare R2 bucket. Supabase still provides
Postgres, the Edge Function, rate limiting and museum metadata. The browser still
uploads and downloads directly, but through short-lived R2 SigV4 presigned URLs
instead of Supabase Storage signed URLs.

- **Removed:** every `storage.from(...)`, `createSignedUploadUrl`,
  `createSignedUrls`, Storage list/remove call and the `MUSEUM_BUCKET` setting.
- **Added:** `supabase/functions/_shared/r2.js`, a dependency-free S3 client with
  presigned PUT/GET, HEAD verification, paginated list and retrying delete.
- **Credentials:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET` (and optional `R2_ENDPOINT`) exist only as Edge Function secrets.
- **URL lifetimes:** uploads 15 minutes; downloads at most one hour and clamped
  to the museum's remaining lifetime.
- **Verification:** finalize HEADs every object and requires exact byte size and
  content type before `ready_at` is set.
- **Cleanup:** lists R2 keys, deletes objects first, then the DB row. A failure
  keeps the row; the next hourly run retries only what remains.
- **Migration:** `20261028120000_phase3_r2_photo_storage.sql` drops the legacy
  Storage policy and removes the old bucket only if it is empty. It never drops
  tables or rewrites photo metadata.
- **Docs:** `SUPABASE-SETUP.md` now documents the exact R2 variables and CORS
  policy. `.env.example` lists the same names.
- **Tests:** presigning is checked against published AWS SigV4 vectors, plus
  object HEAD, list, delete, retry and cleanup-failure tests.

Supabase Storage is no longer a production dependency.

---

## 1. Scope note: Phase 2 was absent

The repository did not contain Phase 2 work: no `PHASE-2-REPORT.md`, no landing
page, no client router, and no personalization form. Rather than rebuild an
unknown Phase 2 design, Phase 3 added the minimum fields needed for sharing to
the existing menu:

- museum title,
- recipient name,
- dedication (optional),
- closing message (required),
- per-photo caption and date (existing photo data),
- a **Create Share Link** action with progress, the resulting URL, copy/open
  actions, and an expiry line.

The local preview continues to work exactly as before. The share action is
disabled until the details validate and 5–15 photos are present. This is a scope
decision, not a claim that Phase 2 was completed.

---

## 2. What changed

### 2.1 Database and R2 object storage

New migration `supabase/migrations/20261026090000_phase3_museums.sql`:

| Object | Purpose |
| --- | --- |
| `public.museums` | One gift: public id, text, timestamps, `ready_at`, completion-token hash |
| `public.museum_photos` | Ordered metadata; `storage_path` is an R2 object key |
| `public.creation_events` | Salted IP hashes for creation rate limiting |
| Cloudflare R2 bucket | Private, server-generated keys, JPEG/PNG/WebP only by application validation |

The R2 migration `20261028120000_phase3_r2_photo_storage.sql` retires the old
Supabase Storage access path. It drops the `storage.objects` policy and deletes
the legacy `museum-photos` bucket only when it is empty; a non-empty legacy
bucket is left for manual review. No table, row or photo metadata is dropped.

Server-controlled rules are enforced in the database, not just in the client:

- `public_id` must be exactly 22 base64url characters.
- `created_at` is always `now()`; `expires_at` can never exceed `created_at + 7 days`.
- On update, expiry can only be shortened; id, public id, creation time and token
  hash are immutable.
- `ready_at` can only be set when the museum has 5–15 photo rows.
- Photos cannot be inserted or updated after a museum is shared.
- RLS is enabled with **no policies for `anon` or `authenticated`**. Only
  `service_role` has table policies; the legacy Storage policy is removed.
- `consume_creation_slot()` serializes per-IP-hash checks and prunes old events.

New migration `20261026090100_phase3_cleanup_schedule.sql`:

- Creates `public.trigger_museum_cleanup()`, which reads three Vault secrets and
  posts to the cleanup route with `pg_net`.
- Schedules `museum-cleanup` hourly at `:17`.
- Grants execute only to `service_role`; `pg_cron` never holds the service-role
  key.

`supabase/verify-cleanup.sql` contains read-only verification queries plus a
manual expiry test.

### 2.2 Edge Function (`museum-api`)

One function owns the service-role key and all privileged operations:

| Route | Behaviour |
| --- | --- |
| `GET /health` | Reports whether Supabase and R2 credentials are visible |
| `POST /museums` | Validates input, rate-limits, inserts draft + metadata, returns R2 presigned upload URLs |
| `POST /museums/:id/complete` | Checks the completion token, HEADs every R2 object for size/MIME, then atomically sets `ready_at` |
| `POST /museums/:id/abort` | Deletes a draft's R2 objects and row; refuses a shared museum |
| `GET /museums/:publicId` | Returns a finalized, unexpired museum and short-lived R2 download URLs |
| `POST /cleanup` | Requires `x-cleanup-secret`; deletes expired and abandoned museums |

Security and reliability details:

- Public reads require `ready_at IS NOT NULL` **and** `expires_at > now()`.
  Expiry is checked at read time, before cleanup runs.
- The public response contains title, recipient, dedication, closing message,
  dates and photo URLs/metadata. It never contains the completion token or hash.
- R2 download URLs are at most one hour **and clamped to the museum's remaining
  lifetime**, so a museum fetched just before expiry cannot keep serving photos
  for a full hour afterwards.
- Finalization uses a conditional update (`.is('ready_at', null)`), so concurrent
  finalize calls resolve to success instead of creating inconsistent state.
- Upload verification sends a signed HEAD per object and compares exact byte
  size and content type against the photo row. Missing or mismatched objects
  return `409 incomplete` with their positions.
- Cleanup removes R2 objects first, then the row (cascading photo rows). A
  listing/deletion failure leaves the row for the next run; a row-only failure is
  retried and simply finds no objects. Both paths are idempotent. Individual
  deletes retry once on transient 429/5xx/network errors.
- Cleanup refuses to run at all when R2 is not configured, so a database row
  cannot be deleted while its bytes are unreachable.
- Request bodies are capped at 64 KB; the server re-validates count, text
  lengths, types, dimensions, per-photo size and total size.
- Creation is limited per salted IP hash (default 10/hour).
- `verify_jwt = false` in `supabase/config.toml` because the function performs its
  own token/id/expiry/secret authorization and must work with both legacy anon
  JWTs and new `sb_publishable_...` keys. The service-role key and R2 secret
  remain server-side.

### 2.3 Client

New backend modules:

| File | Purpose |
| --- | --- |
| `src/backend/config.js` | Reads public env, rejects service-role-looking keys, builds function URLs |
| `src/backend/api.js` | Typed API wrapper, timeouts, friendly error mapping |
| `src/backend/shareLink.js` | Validates and builds `/m/<id>` links, tolerates query/hash |
| `src/backend/creatorValidation.js` | Shared creator-field validation |
| `src/backend/photoOptimize.js` | 1600 px, WebP/JPEG, 1.5 MB target, EXIF-safe decode |
| `src/backend/upload.js` | R2 presigned PUT uploads with byte progress and retry |
| `src/backend/shareFlow.js` | Orchestrates validate → optimize → draft → upload → finalize → abort on failure |

Behaviour:

- Photos are compressed before upload; the museum itself still renders from
  whatever URL `buildMuseum` receives.
- Uploads go directly to R2 with no credential header; retries overwrite the
  same server-generated key.
- Upload progress is shown per phase and byte count, with Cancel.
- A failed upload aborts the draft and preserves the original error. If abort also
  fails, the UI notes that cleanup will retry and the hourly job removes it.
- Finalization is retried once after `network`/`unavailable`, which covers a lost
  response after the museum was already made readable. It is not retried for
  validation errors.
- The share result is shown only after a successful finalize; the URL is built
  from the server's public id.
- Invalid `/m/...` ids show a friendly page without calling the API.
- Expired, missing, malformed and network failures each have their own copy and
  recovery action. A network error offers **Try again** and **Create your own
  museum**.
- Leaving a shared museum shows an exit panel; **Step back inside** refetches the
  museum so expired signed URLs are not reused.

`buildMuseum(config)` was not coupled to storage or Supabase. The existing
Three.js scene, music, controls and Phase 1A/1B visual work are unchanged.

### 2.4 Supporting files

- `supabase/schema.test.js` — contract tests for SQL, Edge Function and browser
  security properties.
- `src/backend/*.test.js` — client unit tests.
- `supabase/functions/_shared/*.test.js` — validation, ids, rules, cleanup tests.
- `tests/integration/museum-api.integration.test.js` — opt-in live Supabase + R2 test.
- `scripts/mock-museum-api.mjs` — in-memory UI verification server.
- `.env.example`, `public/_redirects`, `supabase/config.toml`.
- `SUPABASE-SETUP.md` — deployment, verification, security and cost guide.
- `README.md` — updated sharing, setup, routes, scripts and testing.

---

## 3. Files

**New**

| File | Purpose |
| --- | --- |
| `src/backend/config.js` | Public backend config and secret-key guard |
| `src/backend/api.js` | API wrapper and friendly errors |
| `src/backend/shareLink.js` | Share-link parsing/building |
| `src/backend/creatorValidation.js` | Creator field validation |
| `src/backend/photoOptimize.js` | Client photo compression |
| `src/backend/upload.js` | Signed uploads, retry, progress |
| `src/backend/shareFlow.js` | End-to-end creator orchestration |
| `src/backend/*.test.js` | 7 client backend test files |
| `supabase/migrations/*.sql` | Schema/RLS, cleanup schedule and R2 retirement |
| `supabase/functions/museum-api/index.ts` | Edge Function API |
| `supabase/functions/_shared/r2.js` | Dependency-free R2 SigV4 presign/HEAD/list/delete client |
| `supabase/functions/_shared/*.js` | Validation, ids, rules, cleanup |
| `supabase/functions/_shared/*.test.js` | Shared logic tests |
| `supabase/schema.test.js` | SQL/function/browser security contracts |
| `supabase/verify-cleanup.sql` | Operational verification queries |
| `supabase/config.toml` | Function JWT setting |
| `tests/integration/museum-api.integration.test.js` | Opt-in live Supabase + R2 test |
| `scripts/mock-museum-api.mjs` | In-memory UI mock |
| `.env.example` | Public env template and server secret list |
| `public/_redirects` | SPA fallback for `/m/<id>` |
| `SUPABASE-SETUP.md` | Setup and operations guide |

**Modified**

`src/main.js` (share route, loading/error/exit panels, refetch retry),
`src/ui/overlay.js` (creator fields, photo gating, share progress/result/copy),
`src/ui/upload.js` (15-photo limit and summary), `src/ui/ui.css` (share and
message panels), `src/storage/museumSource.js` (details into the local config),
`README.md`, `.gitignore`, `package.json` (test scripts).

The Phase 1 scene, music, controls and visual files are untouched by Phase 3
apart from the existing uncommitted Phase 1 work.

---

## 4. Automated verification (actually run)

```text
npm test
  Test Files  27 passed | 1 skipped (28)
       Tests  319 passed | 6 skipped (325)

npm run build
  ✓ 47 modules transformed.
  dist/index.html                   4.88 kB │ gzip:   1.61 kB
  dist/assets/index-BhKK9v4e.css   13.99 kB │ gzip:   3.47 kB
  dist/assets/index-t8ueCwIa.js   582.39 kB │ gzip: 154.54 kB
  ✓ built in 681ms
```

The opt-in integration file is the skipped suite. Without
`MUSEUM_INTEGRATION_URL`, `npm test` stays hermetic. The >500 kB warning is Three.js
and is unchanged in kind from Phase 1B. `npm run test:unit` (the same hermetic
suite without the skipped integration file) also passes: 27 files, 319 tests.

New test coverage includes:

- **Creation/persistence:** details normalization, server-controlled metadata,
  photo count gating, draft creation, abort on failure.
- **Uploads/retrieval:** presigned PUT retry/overwrite, progress, photo
  optimization dimensions/size, public read shape, presigned GET output.
- **R2 signing and operations:** published AWS SigV4 header/query vectors, PUT
  content-type binding, TTL clamps, HEAD size/type, 404 handling, paginated XML
  listing, delete retry, path-traversal rejection, and no secret leakage.
- **Share ids:** 22-character base64url format, validation, URL parsing with
  query/hash, malformed-id handling.
- **Expiry/cleanup:** rules for expired/ready/draft states, R2-before-row
  ordering, idempotent retry, partial R2 deletion retry, listing failure,
  failure continuation, bounded batches.
- **Validation:** 5–15 photos, types, sizes, dimensions, text limits.
- **Security contracts:** RLS/no anon policies, legacy bucket retirement without
  data loss, R2-only photo operations, service-role/R2 secrets only in function
  source, no privileged key in client source, public response excludes tokens,
  cleanup secret check, `verify_jwt` rationale.
- **Deployment contract:** every relative Edge Function import resolves from
  `supabase/functions/museum-api/` to the shared `../_shared/` directory.
- **Finalize retry:** one retry on `network`/`unavailable`, no retry on validation
  errors, abort if the retry also fails.
- **UI:** 15-photo partition and limit summaries.

Issues found and fixed during review:

- **Edge Function import paths.** The function imported `./_shared/...`, which
  resolves inside `museum-api/` and would fail at deploy time. The imports now use
  `../_shared/...`, and `schema.test.js` checks every relative import resolves to
  the shared directory.
- R2 signed download URL TTL is clamped to the museum's remaining lifetime.
- An upload retry PUTs the same server-generated R2 key and overwrites it, so the
  client treats any 2xx as success; finalize still verifies size and type.
- HEIC detection handles the wrapped failure entry shape returned by the upload
  batch.
- Caption/date labels are trimmed in the share flow.
- Malformed share ids show the invalid page without making an API call.
- Finalization retries once after `network`/`unavailable`, with tests for retry,
  non-retry, and retry-exhausted paths.
- The client now derives a per-photo byte budget from the server's 20 MB total
  limit (important for 14–15 photos) and rejects any batch that still exceeds it
  before creating a draft.

---

## 5. Browser checks (mock API only)

Environment: Chromium in the desktop preview pane, Vite dev server at
`http://127.0.0.1:5173`, `scripts/mock-museum-api.mjs` at
`http://127.0.0.1:54321`. **No live Supabase project or R2 bucket was used.**

The checks below cover the creator form, upload progress, share result and the
public-read error states against the mock. The mock returns a local
`/mock-storage/<token>` URL and accepts a direct browser `PUT` with
`Content-Type`, which mirrors the presigned-R2 contract the client uses, but it
does no SigV4 signing, expiry enforcement or real object storage. The R2 upload
path itself was verified by unit tests, not by a browser against Cloudflare.

| Check | Result |
| --- | --- |
| Fill title/recipient/dedication/closing message and upload 6 demo photos | Pass |
| Share progress reaches the result panel | Pass |
| Result URL shape `/m/<22 chars>` and copy/open controls | Pass |
| Open the generated link in a separate tab | Pass |
| Shared museum shows title, recipient, dedication and 6 photos | Pass |
| No console errors during create/open | Pass |
| Public read response contains no completion token | Pass |
| Missing id `BBBB…` shows the not-found page | Pass |
| Expired id `AAAA…` shows the closed page | Pass |
| Malformed `/m/nope` shows the invalid-link page without an API call | Pass |
| Bare `/m/` shows the invalid-link page | Pass |
| Exit panel appears after leaving; **Step back inside** refetches | Pass |
| 2 photos: share disabled with “Add 3 more photographs…” hint | Pass |
| Share button disabled until title/recipient/closing message are valid | Pass |
| Mobile-width layout / touch share flow | Not checked in this phase |

The mock deliberately has no RLS, SigV4 signing, URL expiry, rate limiting or
cleanup, so these checks validate the client and UI contract, not the production
backend or live R2 behaviour.

---

## 6. Partial failures and retry behaviour

- **Upload fails:** the draft is aborted. The original error reaches the UI; a
  cleanup failure does not mask it.
- **Abort fails:** the user sees the original error and a cleanup-pending notice;
  the hourly cleanup removes abandoned drafts after one hour.
- **Finalize says incomplete:** the UI reports that some photos did not finish
  and offers a retry. The draft stays available for that retry.
- **Finalize response lost:** one retry on `network`/`unavailable`; finalization is
  idempotent and returns the same public id if already ready.
- **Cleanup partially fails:** successful museums are deleted; failures are
  reported in the response summary and retried on the next run.
- **Share link before finalize:** the public id is not returned and `ready_at` is
  null, so the link is not usable.

There are no orphaned R2 objects on the normal abort path. The abnormal path
depends on the scheduled cleanup, which is documented and tested at the
orchestration level.

---

## 7. Security review

| Concern | Mitigation |
| --- | --- |
| Service-role or R2 key in browser | Only the Edge Function environment; client config rejects service-role-looking keys; the browser receives only presigned URLs |
| Public create/update/delete | No anon/authenticated table policies; the R2 bucket is private; writes require a short-lived server-issued presigned PUT |
| Reading drafts | Public read requires `ready_at`; id alone is not enough |
| Reading expired museums | 410 at read time before cleanup |
| Guessable links | 128-bit random public ids; 22 base64url characters |
| Creator capability theft | 32-byte completion token, stored only as SHA-256; compared in constant time |
| Presigned URL overstay | Uploads expire after 15 minutes; downloads after at most one hour, clamped to museum expiry |
| Cleanup trigger abuse | Separate high-entropy secret, constant-time compared; endpoint is not public |
| Rate-limit abuse | Salted IP hash, default 10/hour, serialized SQL check |
| SQL injection / arbitrary paths | Parameterized Supabase client calls; paths generated server-side |
| Oversized / wrong-type uploads | Client compression, server validation, a signed `content-type`, and finalize HEAD checks for exact size and type |

Known limits: this is capability-link security, not account security. Anyone with
the link can view the museum until it expires, and the link can be forwarded. The
IP rate limit is best-effort. There is no moderation or content scanning, by
design (no AI, no approvals).

---

## 8. Not verified / limits

- **No live Supabase project.** The migrations (including the legacy Storage
  retirement), RLS policies, rate-limit RPC, Vault secrets, `pg_cron`/`pg_net`
  schedule, Edge Function deployment and production CORS were not executed
  against a real project. They are covered by source-contract tests and a local
  mock, not by live evidence.
- **No live R2 bucket.** Bucket creation, token scope, the CORS policy, SigV4
  presigned PUT/GET, HEAD verification, paginated list and delete were not
  exercised against Cloudflare. SigV4 output is checked against published AWS
  test vectors; R2 compatibility is inferred from its documented S3 API.
- **The opt-in integration test was not run.** It is implemented and skips
  cleanly without credentials.
- **Real seven-day expiry was not observed.** Expiry logic is unit-tested and the
  manual SQL path is documented in `SUPABASE-SETUP.md`.
- **Real cleanup was not observed.** R2-before-row deletion, retries and the
  hourly job are tested at the orchestration level and documented operationally.
- **Cross-device/cross-browser access** was checked only as a second tab in the
  same browser against the mock. Real phone/desktop sharing needs a live project.
- **Real phone hardware** remains unavailable, as in Phase 1B. Touch sharing and
  the mobile layout were not exercised this phase.
- **Production hosting fallback** (`public/_redirects`) was not tested on Netlify
  or Cloudflare Pages.
- **Supabase Free capacity** is not guaranteed. Cost and bottleneck guidance is
  arithmetic and operational advice, not a capacity promise. Free-plan limits can
  change, and free projects may pause after inactivity (which stops both link
  serving and cleanup until restored).
- **Phase 2** was not present in the repository; the creator UI is a minimal
  extension of the existing menu, not a rebuilt Phase 2 experience.
- **Photo content** in browser checks came from the demo fixture. Real photo
  uploads through R2 presigned URLs were not exercised live.
- **No early revocation.** A finalized museum cannot be deleted or edited. If a
  creator changes the details/photos and creates a new link, the old link remains
  viewable until its own expiry. This matches the no-accounts, seven-day-retention
  design but should be explained to creators.

---

## 9. Scope compliance

- No accounts, recipient authentication, payments, checkout, orders,
  subscriptions, approvals, multiplayer or AI.
- No service-role key or privileged secret in the frontend.
- No public database or R2 create/update/delete access; creation goes through the
  validated, rate-limited Edge Function, and the bucket stays private.
- `buildMuseum(config)` remains storage-independent.
- Supabase Storage is not a production dependency; the legacy bucket is retired
  only after it is empty.
- Committed SQL migrations define all schema and policies.
- Existing Three.js museum, music, controls and Phase 1A/1B improvements are
  preserved.
- Tests distinguish hermetic automated coverage from the opt-in live integration
  test.
- Full test suite and production build pass.
- No commits were made.

---

## 10. Approval gate

Phase 3 is implemented and verified as far as this environment allows. Before
calling the share feature production-ready, follow
[`SUPABASE-SETUP.md`](SUPABASE-SETUP.md) §6–§8 against a development project:
create the private R2 bucket, apply the exact CORS policy, deploy the Edge
Function with the R2 secrets, and configure the Vault cleanup values. Then run:

```bash
MUSEUM_INTEGRATION_URL=https://<project-ref>.supabase.co \
MUSEUM_INTEGRATION_ANON_KEY=<publishable-or-anon-key> \
npm run test:integration
```

Confirm `/health` reports `"storage": "r2"`, create and open a museum from a
second device, check that an abandoned draft's R2 objects are removed before its
row, and exercise the manual expiry/cleanup path in `SUPABASE-SETUP.md` §9.4.

**Stopping here for approval before Phase 4.**
