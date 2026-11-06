# Supabase + Cloudflare R2 Setup

This document sets up the sharing backend for Personal Museum. The museum still
renders from `buildMuseum(config)` and the local preview still uses IndexedDB.

Production uses:

- **Supabase Postgres** for museum metadata, photo metadata, retention rules and
  creation rate limiting.
- **One Supabase Edge Function** (`museum-api`) for validation, completion tokens,
  presigned URL creation, object verification and cleanup.
- **A private Cloudflare R2 bucket** for photo bytes. The browser uploads and
  downloads directly through short-lived presigned URLs.
- **`pg_cron` + `pg_net` + Vault** for the hourly cleanup call.

Supabase Storage is no longer used for photos. With no `VITE_SUPABASE_*`
variables the local museum works and the share button reports that sharing is
not configured.

> **Not tested against live Supabase or R2 in this repository.** The code,
> migrations, signing implementation and client were tested with unit tests, a
> local mock API and the AWS SigV4 published test vectors. They were **not** run
> against a real R2 bucket or a live Supabase project. Follow the verification
> steps below on a development project before calling the integration live.

---

## 1. What gets provisioned

| Piece | Purpose |
| --- | --- |
| `public.museums` | One row per gift. Holds the 22-character public id, text, timestamps, `ready_at` and a SHA-256 hash of the creator's completion token. |
| `public.museum_photos` | Ordered photo metadata. `storage_path` is now an **R2 object key**, not a Storage path. |
| `public.creation_events` | Salted IP hashes for best-effort creation rate limiting. |
| Cloudflare R2 bucket | **Private** bucket. Photo bytes only. No public bucket URL or custom domain. |
| `museum-api` Edge Function | The only code allowed to use the service-role key and R2 credentials. |
| `pg_cron` + `pg_net` + Vault | Hourly HTTP call to the cleanup route. The scheduler never holds the service-role or R2 secret. |

Shared museums expire **seven days after `created_at`**. Read access is refused
as soon as `now() > expires_at`, even if cleanup has not run yet.

Photo object keys are generated server-side:

```
museums/<museum-uuid>/<two-digit-position>-<random-suffix>.<jpg|png|webp>
```

---

## 2. Prerequisites

- A Supabase project (use a **development** project first).
- A Cloudflare account with R2 enabled.
- The [Supabase CLI](https://supabase.com/docs/guides/cli), or access to the
  Dashboard SQL editor.
- Node.js 18+ for the frontend and tests.

The repository contains:

```
supabase/
  config.toml
  migrations/20261026090000_phase3_museums.sql
  migrations/20261026090100_phase3_cleanup_schedule.sql
  migrations/20261028120000_phase3_r2_photo_storage.sql
  functions/museum-api/index.ts
  functions/_shared/*.js
  verify-cleanup.sql
```

---

## 3. Create and link the Supabase project

In the Supabase Dashboard, create a project and note:

- the project reference (`<project-ref>`),
- the project URL (`https://<project-ref>.supabase.co`),
- the **publishable/anon** key from Project Settings → API.

Link the CLI:

```bash
supabase login
supabase link --project-ref <project-ref>
```

For frontend configuration later, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set only the public URL and public key there. **Never** put a service-role key,
R2 access key or R2 secret in a `VITE_*` variable: Vite inlines those values into
the browser bundle.

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```

The client refuses a Supabase key that looks like a service-role key, but that
check is a guardrail, not the security boundary.

---

## 4. Enable the required Supabase extensions

In **Dashboard → Database → Extensions**, enable:

- `pgcrypto` (used by the schema migration),
- `pg_cron` (hourly schedule),
- `pg_net` (HTTP call from Postgres),
- Vault (`supabase_vault`), if your project does not already have the `vault`
  schema.

`pg_cron` and `pg_net` availability can vary by plan and project state. If they
are not available on your plan, see [§11](#11-alternative-cleanup-scheduler)
for an external scheduler.

You can also enable them in the SQL editor:

```sql
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Vault is usually already installed; enable it from the Dashboard if this fails.
create extension if not exists supabase_vault;
```

---

## 5. Apply the migrations

### Option A — CLI

With the extensions enabled first:

```bash
supabase db push
```

This applies the migrations in filename order. The last one retires the legacy
Supabase Storage access path. The cleanup schedule is harmless before Vault is
configured: it logs a notice and skips.

### Option B — SQL editor

Run the files in order and paste the full contents:

1. `supabase/migrations/20261026090000_phase3_museums.sql`
2. `supabase/migrations/20261026090100_phase3_cleanup_schedule.sql`
3. `supabase/migrations/20261028120000_phase3_r2_photo_storage.sql`

### What the migrations enforce

- Public ids must match `^[A-Za-z0-9_-]{22}$`.
- A museum can only become readable (`ready_at` set) when it has 5–15 photos.
- Photos cannot be added or changed after a museum is shared.
- `created_at` is always `now()`, and `expires_at` can never be later than
  `created_at + 7 days`.
- The public id, creation time and completion-token hash are immutable after
  insert.
- RLS is enabled with **no policies for `anon` or `authenticated`**.
- The R2 migration drops the old `storage.objects` policy. It removes the
  legacy `museum-photos` Storage bucket **only when that bucket is empty**, so
  existing bytes are never deleted. A non-empty legacy bucket is left in place
  for manual review; the application no longer reads it.

No table, row or photo metadata is dropped or rewritten by the R2 migration.

---

## 6. Create the private R2 bucket and API token

### 6.1 Bucket

In **Cloudflare Dashboard → R2 → Create bucket**:

1. Name it, for example `personal-museum-photos`.
2. Choose a location (Automatic is fine).
3. Do **not** enable a public development URL or connect a custom public domain.
   The bucket must stay private. R2 only serves it through presigned URLs created
   by the Edge Function.

### 6.2 API token

In **R2 → Manage R2 API Tokens → Create API token**:

- Permission: **Object Read & Write** (or Admin Read & Write) for this bucket.
  The function needs list, HEAD, presigned GET/PUT and delete.
- Scope: the single museum bucket created above.
- Copy the **Access Key ID** and **Secret Access Key** immediately. The secret is
  shown once.

Copy the **Account ID** from the R2 overview. It is the 32-character hexadecimal
Cloudflare account id.

### 6.3 CORS

Browser uploads use `PUT` with a `Content-Type` header, and downloads use `GET`.
Both are cross-origin requests to
`https://<account-id>.r2.cloudflarestorage.com`, so the bucket must allow them.

In **R2 → your bucket → Settings → CORS Policy**, paste a policy like this,
replacing the production origin with the exact origin that serves the app:

```json
[
  {
    "AllowedOrigins": [
      "https://museum.example.com",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Requirements:

- **Exact origins only.** Scheme, host and port must match. No trailing slash.
  `https://museum.example.com` and `https://www.museum.example.com` are different
  origins and both need entries if both are used.
- Keep `GET` (photos), `HEAD` (metadata) and `PUT` (uploads). `OPTIONS` preflight
  is handled by R2 CORS automatically.
- `content-type` must be allowed. The presigned PUT signs the exact content type,
  and the browser must send that header.
- Do not use `"*"` for a production bucket. Add the localhost/127.0.0.1
  development origins (`5173` for Vite, `4173` for `vite preview`) only while
  developing locally.
- The CORS origin list is separate from `MUSEUM_ALLOWED_ORIGINS`, but both should
  contain the same deployed origins.
- For Cloudflare Pages, add the exact `https://<pages-project>.pages.dev` origin
  and any custom domain. Preview deployment hostnames change per deployment; add
  one temporarily only while testing it. See
  [`DEPLOYMENT.md`](DEPLOYMENT.md) for the Pages build settings and the matching
  Edge Function secret command.

---

## 7. Deploy the Edge Function and its secrets

Generate two independent random secrets. The cleanup secret must be at least 24
characters (the function refuses to run cleanup otherwise).

```bash
openssl rand -hex 32   # MUSEUM_CLEANUP_SECRET
openssl rand -hex 32   # MUSEUM_RATE_LIMIT_PEPPER
```

Set all secrets on the Supabase project:

```bash
supabase secrets set \
  MUSEUM_CLEANUP_SECRET=<cleanup-secret> \
  MUSEUM_RATE_LIMIT_PEPPER=<rate-limit-pepper> \
  MUSEUM_ALLOWED_ORIGINS=https://your-site.example \
  MUSEUM_CREATE_LIMIT_PER_HOUR=10 \
  MUSEUM_CLEANUP_BATCH=25 \
  R2_ACCOUNT_ID=<32-character-cloudflare-account-id> \
  R2_ACCESS_KEY_ID=<r2-access-key-id> \
  R2_SECRET_ACCESS_KEY=<r2-secret-access-key> \
  R2_BUCKET=personal-museum-photos
```

### 7.1 Exact R2 environment variables

| Name | Required | Expected value |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | Yes | 32-character hexadecimal Cloudflare account id. Used to build the default S3 endpoint. |
| `R2_ACCESS_KEY_ID` | Yes | Access Key ID from the R2 API token. This value appears inside presigned URLs, as required by SigV4; it is not the secret. |
| `R2_SECRET_ACCESS_KEY` | Yes | Secret Access Key for the R2 API token. Shown once. Never commit it, log it or expose it to the browser. |
| `R2_BUCKET` | Yes | Private bucket name, 3–63 lowercase letters, digits or hyphens; cannot start or end with a hyphen. Example: `personal-museum-photos`. |
| `R2_ENDPOINT` | No | Defaults to `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. Set only when using a jurisdiction-specific endpoint, for example `https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. Must use `https`. |

R2's SigV4 signing region is always `auto`. There is no `R2_REGION` variable.

Presigned URL lifetimes are fixed in code:

- **Upload:** 15 minutes.
- **Download:** at most 60 minutes, and clamped to the museum's remaining
  lifetime. A museum fetched 30 seconds before expiry gets 30-second URLs.

### 7.2 Other Edge Function secrets

| Name | Required | Expected value |
| --- | --- | --- |
| `MUSEUM_CLEANUP_SECRET` | Yes | Random string, at least 24 characters. Sent in `x-cleanup-secret`. |
| `MUSEUM_RATE_LIMIT_PEPPER` | Recommended | Random string used to hash client IPs. If omitted, the service-role key is used. |
| `MUSEUM_ALLOWED_ORIGINS` | Recommended | Comma-separated exact origins for the function's own CORS responses. `*` is development-only. |
| `MUSEUM_CREATE_LIMIT_PER_HOUR` | No | Default `10`, clamped to 1–100. |
| `MUSEUM_CLEANUP_BATCH` | No | Default `25`, clamped to 1–100 museums per run. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to
deployed Edge Functions. Do not set them in the browser or `.env.local`.

Deploy:

```bash
supabase functions deploy museum-api
```

`supabase/config.toml` sets `verify_jwt = false` for this function. That is
intentional: the function does its own authorization (completion tokens, public
ids, expiry, and the cleanup secret) and must work with both legacy anon JWTs and
new `sb_publishable_...` keys. The service-role key and R2 secret still exist only
inside the function environment. If you deploy through the Dashboard instead of
the CLI, disable **Verify JWT** for `museum-api`.

---

## 8. Configure Vault for the hourly cleanup

The cron function reads three secrets at run time. Create them once in the SQL
editor:

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/museum-api/cleanup',
  'museum_cleanup_url',
  'Hourly museum cleanup endpoint'
);

select vault.create_secret(
  '<same value as MUSEUM_CLEANUP_SECRET>',
  'museum_cleanup_secret',
  'x-cleanup-secret header value'
);

select vault.create_secret(
  '<publishable-or-anon-key>',
  'museum_anon_key',
  'Public key used for the function gateway'
);
```

To rotate a value later:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'museum_cleanup_secret'),
  '<new-value>'
);
```

Then update the Edge Function secret to the same value and redeploy/restart it.

The cleanup endpoint still requires `x-cleanup-secret`. `pg_cron` and Vault hold
only the public anon key and that separate secret; the service-role key and R2
credentials never leave the Edge Function.

---

## 9. Verify the deployment

### 9.1 Health

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export ANON_KEY="<publishable-or-anon-key>"

curl -sS "$SUPABASE_URL/functions/v1/museum-api/health" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

Expected:

```json
{"ok":true,"service":"museum-api","storage":"r2","message":"Ready."}
```

`503` with `"ok":false` means the function cannot see its Supabase credentials or
its R2 configuration. The message names the missing side, never the values.
Check the function secrets and logs.

### 9.2 End-to-end creation and retrieval

Use a development project and a development R2 bucket only. This test creates
real museums and leaves them for scheduled cleanup (a shared museum intentionally
cannot be deleted early).

```bash
MUSEUM_INTEGRATION_URL="$SUPABASE_URL" \
MUSEUM_INTEGRATION_ANON_KEY="$ANON_KEY" \
npm run test:integration
```

It checks health, malformed/unknown links, a real draft, five presigned R2
uploads, finalization, public retrieval, a presigned GET returning the exact
bytes, the seven-day lifetime, refusal to abort a shared museum, an incomplete
upload rejected by object verification, and a cleanup request without the secret.

### 9.3 SQL checks

Open `supabase/verify-cleanup.sql` and run the read-only queries:

- museums past expiry waiting for a run,
- museum/photo/draft row counts,
- photo rows and expected R2 bytes per museum,
- orphaned photo rows,
- the cron job and recent `cron.job_run_details`,
- recent `net._http_response` entries.

R2 object counts are not stored in Postgres. Check them in **Cloudflare → R2 →
your bucket → Objects**, using the prefix `museums/<museum-id>/`.

### 9.4 Expiry and cleanup test (writes data)

```sql
-- Shorten one museum's life. The trigger permits shortening, never extending.
update public.museums
   set expires_at = now() - interval '1 second'
 where public_id = '<22-character-public-id>';

-- Ask the cron helper to call the function now.
select public.trigger_museum_cleanup();
```

Wait a few seconds, then re-run queries 1–5 from `verify-cleanup.sql` and check
the same `museums/<museum-id>/` prefix in R2:

- the `museums` row is gone,
- its `museum_photos` rows are gone (cascade),
- its R2 objects under `museums/<museum-id>/` are gone.

The public link should already return **410 expired** before cleanup runs, and
**404 not found** after the row is deleted.

You can also call cleanup directly:

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/museum-api/cleanup" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "x-cleanup-secret: <cleanup-secret>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

The response is a summary such as:

```json
{"ok":true,"scanned":2,"deleted":2,"failed":0,"objectsRemoved":10,"errors":[]}
```

Cleanup is idempotent and retryable:

1. List every R2 key under each museum prefix.
2. Delete the R2 objects first. Individual deletes are retried once on a
   transient 429/5xx or network failure; a missing object is treated as gone.
3. Delete the database row only after every object is gone.
4. If R2 listing or deletion still fails, keep the row and report the museum in
   `errors`. The next hourly run lists the prefix again and retries only what is
   left.
5. If the row delete fails after the objects are gone, the next run finds no
   objects and deletes the row.

If R2 itself is not configured, cleanup refuses to run (`503`) and deletes
nothing, so bytes cannot be orphaned. A bounded batch drains a backlog over
several runs instead of timing out.

---

## 10. Security model

| Boundary | Rule |
| --- | --- |
| Browser config | Only `VITE_SUPABASE_URL` and a publishable/anon key. The client rejects obvious service-role keys. |
| Database | RLS enabled; no `anon`/`authenticated` policies. Only `service_role` can read or write tables. |
| R2 bucket | Private. No public development URL, no custom public domain, no anonymous object policy. |
| R2 credentials | Only in Edge Function secrets. The secret access key never leaves the function. The access key id appears in presigned URLs, which is inherent to SigV4. |
| Upload URLs | Presigned `PUT`, 15-minute lifetime, one server-generated object key, exact signed `Content-Type`. |
| Download URLs | Presigned `GET`, at most one hour, clamped to the museum's remaining lifetime. |
| Object verification | Finalize sends `HEAD` for every key and requires the exact byte size and content type before setting `ready_at`. |
| Public read | Requires a valid 22-character id, `ready_at IS NOT NULL`, and `expires_at > now()`. Returns only museum text and photo metadata/URLs. |
| Creation | Server validates count (5–15), content types, byte sizes (2 MB each, 20 MB total), dimensions, text lengths and rate limit. |
| Draft access | Finalize/abort require a 32-byte random completion token. Only its SHA-256 hash is stored. |
| Cleanup | Requires `MUSEUM_CLEANUP_SECRET` in `x-cleanup-secret`, constant-time compared. |
| Public ids | 16 random bytes → 22 base64url characters. Not sequential and not derivable. |

There are deliberately **no public insert/update/delete grants**. A share link is
not a database credential; it is looked up by the function.

Client photos are resized to a 1600 px longest edge, encoded as WebP with JPEG
fallback, and capped at 1.5 MB before upload. For 14–15 photos the cap is reduced
automatically so the batch also fits the 20 MB total. The server independently
enforces the 2 MB per-object and 20 MB total limits. R2 does not know the
application's limits; verification is what protects finalization.

---

## 11. Alternative cleanup scheduler

If `pg_cron` or `pg_net` is unavailable, keep the same cleanup route and call it
from any trusted scheduler. Do not put the cleanup secret in browser code.

Example GitHub Actions workflow (store the values as repository secrets):

```yaml
name: Museum cleanup
on:
  schedule:
    - cron: '17 * * * *'
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Call cleanup
        run: |
          curl --fail-with-body -sS -X POST \
            "${{ secrets.SUPABASE_URL }}/functions/v1/museum-api/cleanup" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "x-cleanup-secret: ${{ secrets.MUSEUM_CLEANUP_SECRET }}" \
            -H "Content-Type: application/json" \
            -d '{}'
```

Any scheduler that can make an authenticated HTTPS request works. The endpoint
handles a bounded batch per call.

---

## 12. Local development without Supabase or R2

`scripts/mock-museum-api.mjs` is an in-memory stand-in for UI work. It pretends
to issue signed URLs and keeps uploaded bytes in memory. It has **no security, no
RLS, no real R2 presigned URLs and no cleanup**; never deploy it.

```bash
node scripts/mock-museum-api.mjs
```

In another terminal:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321 \
VITE_SUPABASE_ANON_KEY=local-anon \
npm run dev
```

Reserved links:

| Link | Result |
| --- | --- |
| `/m/AAAAAAAAAAAAAAAAAAAAAA` | Expired page |
| `/m/BBBBBBBBBBBBBBBBBBBBBB` | Not-found page |
| `/m/nope` | Invalid-link page (no API call) |
| `/m/` | Invalid-link page |

The mock keeps everything in memory, so restarting it forgets created museums.
No R2 credentials or bucket are needed for this flow.

---

## 13. Costs, capacity and bottlenecks

Check current Supabase and Cloudflare pricing; free-plan limits and overage
behavior change. Do not treat a free project as guaranteed event capacity.

The practical bottlenecks, in order:

1. **R2 storage.** Each optimized photo can be up to 1.5 MB (2 MB server cap).
   A 5–15 photo museum therefore stores roughly 7.5–22.5 MB. R2's free tier has
   historically included 10 GB-month of storage, so the arithmetic is on the
   order of hundreds of maximum-size museums, not thousands. Most photos will be
   smaller; this is an estimate, not a promise.
2. **R2 operations.** Every creation signs 5–15 PUT URLs and HEADs 5–15 objects.
   Every open signs 5–15 GET URLs; recipients then download the bytes. R2 charges
   per Class A/B operation, and egress to the internet has historically been free
   on R2. Verify current pricing before a large event.
3. **Supabase database and Edge Function.** Text/metadata rows are small.
   `creation_events` is pruned opportunistically during rate-limit checks. Each
   creation makes one draft request, one finalize request and possibly
   abort/retry calls. Photo bytes do not pass through the function.
4. **Scheduled cleanup.** Hourly calls are small in count, but each run lists and
   deletes R2 objects. A large backlog drains over several bounded runs.
5. **Free-project pausing.** A paused Supabase project cannot serve share links
   or run cleanup. R2 objects remain stored. Check the current pause policy and
   restore the project before sending a link that needs to stay open.

Cost controls already in the code: 1600 px client resize, WebP/JPEG compression,
1.5 MB client cap, 2 MB server verification cap, 5–15 photos, seven-day
retention, hourly cleanup, 15-minute upload URLs, one-hour download URLs, and a
default limit of 10 creations per hashed IP per hour.

If you expect many recipients, put a CDN in front of the app, keep museums short,
and monitor R2 storage and operations before widening the creation limit.

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Share button says sharing is not configured | `VITE_SUPABASE_*` missing or invalid | Set `.env.local` and restart Vite. |
| Browser console shows a CORS error on upload | R2 CORS missing the app origin, `PUT`, or `content-type` | Add the exact origin (including port) to the bucket CORS policy. No trailing slash. |
| Browser console shows a CORS error on photo load | R2 CORS missing `GET` for the app origin | Add `GET` (and `HEAD`) to `AllowedMethods`. |
| Upload returns `403 SignatureDoesNotMatch` | Wrong R2 secret, wrong bucket/account endpoint, or the browser sent a different `Content-Type` than the one signed | Recheck the four R2 values; do not transform the content type in the client. |
| Upload returns `403` after a pause | The 15-minute presigned PUT expired | Start the share flow again. The draft is cleaned up after one hour if abandoned. |
| `/health` returns 503 | Supabase or R2 secrets missing/invalid | Read the message; set the named group of secrets and redeploy. |
| `/health` returns `"storage":"missing"` | `R2_*` secrets not visible to the function | Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`; redeploy. |
| Create returns 503 `unavailable` | R2 not configured, rate-limit RPC missing, or DB unreachable | Check function logs, apply migrations, and verify R2 secrets. |
| Create returns 429 | More than 10 creations from one IP in an hour (common on localhost) | Wait, raise the limit, or use a different network. |
| Finalize returns 409 `incomplete` | One or more objects are missing, or size/type does not match | Retry the upload; abandoned drafts are cleaned after one hour. Check R2 CORS first if uploads appeared to succeed. |
| `/m/<id>` returns 404 immediately after creating | Finalize did not complete (`ready_at` null), or the id is wrong | Check the finalize response and function logs. |
| `/m/<id>` returns 410 | Past `expires_at` | Expected after seven days; create a new museum. |
| Photos load for a recipient but expire mid-visit | Download URLs are clamped to museum expiry | Expected; re-open the link before expiry. |
| Cleanup returns 401 | Missing/wrong `x-cleanup-secret` | Match the Vault secret to the Edge Function secret. |
| Cleanup returns 503 "not configured" | `MUSEUM_CLEANUP_SECRET` unset/shorter than 24 characters, or R2 missing | Set the secret/R2 values and redeploy. |
| Cleanup returns `failed` > 0 | R2 list/delete or DB delete failed for those museums | The row is kept; the next hourly run retries. Check function logs / `net._http_response`. |
| R2 objects remain after a cleanup run | A delete failed, so the row was deliberately kept | Check logs; the next run retries the remaining keys. If the row was deleted manually, remove the `museums/<id>/` prefix in R2 manually. |
| Old photos still exist in Supabase Storage | The legacy bucket was non-empty, so the migration kept it | Confirm they are old test data, then delete the `museum-photos` bucket in the Supabase dashboard. |
| Access key id visible in a photo URL | Expected SigV4 behavior | It is the public access key id, not the secret. The secret is never in the URL. |

Useful logs:

```bash
supabase functions logs museum-api
```

```sql
select * from cron.job_run_details order by start_time desc limit 10;
select * from net._http_response order by created desc limit 10;
```

---

## 15. Limits of this setup

- Seven days is fixed in the database trigger and cannot be extended by a
  browser. A privileged maintenance update can only shorten a museum's life.
- There are no accounts. Anyone with the link can read the museum until it
  expires. Do not share private photographs you would not want forwarded.
- The creator cannot delete a museum after it is finalized; it disappears on
  expiry. Abort works only for drafts. Creating a new link does not revoke an
  earlier one: the earlier link remains viewable until its own expiry.
- The rate limit is best-effort and based on a hashed client IP. It is not a
  substitute for authentication or abuse monitoring.
- R2 CORS does not authenticate requests; it only controls browser access.
  Presigned URLs are bearer capabilities until they expire.
- The mock API is for UI work only and has none of these protections.
- This repository has not been run against a live Supabase project or a live R2
  bucket. The verification steps above are the intended acceptance path.
