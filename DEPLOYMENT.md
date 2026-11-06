# Deploying the Frontend to Cloudflare Pages

This is the static frontend deployment guide. The backend is already separate:
Supabase Postgres, the `museum-api` Edge Function, and a private Cloudflare R2
bucket. Nothing in this guide creates or changes database rows or R2 objects.

Project URL: `https://hnfgipdsptvettactslu.supabase.co`

> The current working tree is not committed. Cloudflare Pages builds from Git,
> so commit and push the deployment changes before connecting the repository.

---

## 1. What Cloudflare Pages needs

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Repository root (the folder containing `package.json`) |
| Install command | `npm ci` |
| Build command | `npm run build:deploy` |
| Build output directory | `dist` |
| Node.js version | 22 (also set `NODE_VERSION=22`) |

`build:deploy` runs `check:deploy` first. That check fails the build if the
public Supabase URL or key is missing or still contains `.env.example`
placeholders. A build without this check would otherwise deploy a frontend that
points at `your-project-ref.supabase.co`.

The app must be served from the **origin root**. Share links are generated as
`<current origin>/m/<id>`; no Vite `base` path is configured.

---

## 2. Public environment variables

Add these in **Cloudflare Pages → your project → Settings → Environment
variables** for the Production environment (and Preview if you use it):

```dotenv
VITE_SUPABASE_URL=https://hnfgipdsptvettactslu.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
NODE_VERSION=22
```

Get the public key from **Supabase Dashboard → Project Settings → API**. Use the
publishable key (`sb_publishable_...`) or the legacy `anon` JWT.

These are build-time public values. Vite inlines every `VITE_*` value into the
browser bundle, so they must never contain a secret.

**Never add these to Cloudflare Pages:**

- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `MUSEUM_CLEANUP_SECRET`
- `MUSEUM_RATE_LIMIT_PEPPER`

Those belong only in Supabase Edge Function secrets. The R2 secret never leaves
the function; only short-lived presigned URLs reach the browser.

For local development, copy `.env.example` to `.env.local` and put the same two
public values there. `.env.local` is gitignored.

---

## 3. Add the production origin to both CORS layers

CORS must allow the exact frontend origin in **two** places. Do this before the
first browser test.

### 3.1 Supabase Edge Function

Set `MUSEUM_ALLOWED_ORIGINS` to the exact Pages/custom-domain origins, comma
separated and with no trailing slash:

```bash
supabase secrets set \
  MUSEUM_ALLOWED_ORIGINS=https://<pages-project>.pages.dev,https://museum.example.com \
  --project-ref hnfgipdsptvettactslu

supabase functions deploy museum-api --project-ref hnfgipdsptvettactslu
```

Use the actual Pages hostname and any custom domain you will serve. An unlisted
origin receives `Access-Control-Allow-Origin: null` and the browser blocks the
request. Do not use `*` for a public deployment. If you test a production build
locally with `npm run preview`, add `http://localhost:4173` temporarily; remove
it when finished.

### 3.2 Cloudflare R2 bucket CORS

In **R2 → your bucket → Settings → CORS Policy**, use exact origins:

```json
[
  {
    "AllowedOrigins": [
      "https://<pages-project>.pages.dev",
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

- `PUT` and `content-type` are required for presigned uploads.
- `GET` and `HEAD` are required for presigned photo reads.
- Keep the bucket private. Do not enable a public development URL or public
  custom domain.
- The localhost entries cover Vite (`5173`) and `vite preview` (`4173`). Remove
  them from a production bucket if you never test locally against production.
- Add Cloudflare Pages **preview** origins only temporarily if you need to test
  a preview deployment. Preview hostnames change per deployment; production
  should allow only stable origins.
- If you switch between `pages.dev` and a custom domain, allow both until old
  share links and open tabs have expired.

---

## 4. Create the Pages project

1. In Cloudflare, open **Workers & Pages → Create → Pages → Connect to Git**.
2. Select the Personal Museum repository and the production branch.
3. Enter the build settings from §1.
4. Add the environment variables from §2.
5. Deploy.
6. Optionally attach a custom domain under **Custom domains**. Add that exact
   origin to both CORS lists from §3.

Let Pages build from Git. Do not upload the local `dist/` directory: it is a
generated build that may contain whatever values happened to be in your local
environment. The Pages build must receive the environment variables from §2.

The repository already contains `public/_redirects`:

```text
/*  /index.html  200
```

Vite copies it to `dist/_redirects`. Cloudflare Pages uses it to return
`index.html` for `/m/<id>` so a shared museum works on first load and after a
refresh. Do not replace it with a `404.html`-only fallback.

---

## 5. Verify the deployment

Run these checks against the production Pages URL, preferably with test photos
and a development museum.

1. **Root page:** the creator menu loads over HTTPS.
2. **Demo:** `/?demo=1` loads the bundled demo museum.
3. **Deep link before sharing:** `/m/nope` shows the friendly invalid-link page,
   not a host 404.
4. **Create a museum:** add 5–15 photos, fill the required text, and create a
   share link. Confirm progress reaches the result panel.
5. **Fresh browser:** open the copied `/m/<id>` link in a private window. It must
   load without the creator's IndexedDB or cookies.
6. **Refresh:** reload the shared link and confirm the museum and photos load
   again. Presigned URLs are fetched fresh on each visit.
7. **Second device:** open the same link on a phone or another computer.
8. **Missing museum:** `/m/BBBBBBBBBBBBBBBBBBBBBB` shows the not-found page.
9. **Network tab:** API calls go to
   `https://hnfgipdsptvettactslu.supabase.co/functions/v1/museum-api/...`, and
   uploads/downloads go to `*.r2.cloudflarestorage.com`. No request contains a
   service-role key or R2 secret.
10. **CORS:** no red CORS errors in the console during upload or photo load.
11. **Expiry copy:** an expired museum shows the closed page. Use the manual SQL
    verification in `SUPABASE-SETUP.md`; do not wait seven days for a smoke test.

Share links are generated from `window.location.origin`. Once the custom domain
is live, new links use that domain automatically. Existing links keep the origin
they were created with.

---

## 6. Local preflight and build

```bash
npm ci
npm run check:deploy   # requires real VITE_* values
npm run build:deploy
npm run preview        # serves dist locally; does not emulate _redirects
```

`npm run build` still works without backend values for local-only previews.
`npm run build:deploy` is the deployment build and intentionally refuses
placeholders.

The `vite build` warning about a chunk larger than 500 kB is Three.js and is
expected; it is not a deployment failure.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Share button says sharing is not configured | Pages env values missing or still placeholders | Set both `VITE_*` values for the correct environment and redeploy |
| `check:deploy` fails locally | `.env.local` still has `.env.example` placeholders | Put the real public URL/key in `.env.local` |
| Browser CORS error calling `museum-api` | Pages origin missing from `MUSEUM_ALLOWED_ORIGINS` | Add the exact origin, redeploy the function |
| Browser CORS error uploading or loading photos | Pages origin missing from R2 CORS, or `PUT`/`GET`/`content-type` missing | Update the bucket CORS policy |
| `/m/<id>` works in the app but 404s on refresh | `_redirects` missing from `dist` | Confirm `public/_redirects` exists and rebuild |
| Build fails on Cloudflare with an old Node version | Pages did not pick Node 22 | Set `NODE_VERSION=22` and retry |
| Share link uses a `pages.dev` host after attaching a domain | Link was created before the custom domain | Create a new link from the custom-domain origin |
| Upload 403 `SignatureDoesNotMatch` | Browser sent a different `Content-Type` than was signed, or R2 credentials/bucket are wrong | Check R2 secrets and CORS; do not transform the upload content type |
| Photos upload but do not render | R2 CORS lacks `GET` for the origin | Add `GET` and `HEAD` |

---

## 8. Security checklist

- [ ] Only `VITE_SUPABASE_URL` and the publishable/anon key are in Pages.
- [ ] No service-role, R2, cleanup, or rate-limit secret is in Pages.
- [ ] `MUSEUM_ALLOWED_ORIGINS` lists exact production origins, not `*`.
- [ ] R2 CORS lists exact production origins, and the bucket is private.
- [ ] HTTPS is active on the Pages/custom domain.
- [ ] A shared link was opened in a clean browser and on a second device.
- [ ] Refreshing a shared link works.
- [ ] Invalid, missing, and expired links show the app's own pages.
- [ ] No secret appears in the browser bundle or Network tab.

Backend setup, R2 secrets, migrations, cleanup, and expiry verification remain in
[`SUPABASE-SETUP.md`](SUPABASE-SETUP.md).
