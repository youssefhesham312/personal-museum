// Supabase Edge Function: museum-api
//
// Public, account-less API for creating, finalizing and reading museums.
// The service-role key is used only here, never in the browser.
//
// Routes (relative to /functions/v1/museum-api):
//   GET  /health
//   POST /museums                         create a draft + signed upload URLs
//   POST /museums/:id/complete            verify uploads and make the museum readable
//   POST /museums/:id/abort               delete a draft the creator abandoned
//   GET  /museums/:publicId               read one finalized, unexpired museum
//   POST /cleanup                         scheduled cleanup (secret header only)

import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  CONTENT_TYPE_EXTENSIONS,
  MUSEUM_LIMITS,
  validateMuseumInput,
} from '../_shared/validation.js';
import {
  createCompletionToken,
  createPublicId,
  isPublicId,
  randomToken,
  safeEqual,
  sha256Hex,
} from '../_shared/ids.js';
import { isExpired, sortPhotos } from '../_shared/museumRules.js';
import { runMuseumCleanup } from '../_shared/cleanup.js';
import {
  R2_DOWNLOAD_TTL_SECONDS,
  R2_UPLOAD_TTL_SECONDS,
  createR2Client,
  r2ConfigFromEnv,
} from '../_shared/r2.js';

const FUNCTION_SLUG = 'museum-api';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CLEANUP_SECRET = Deno.env.get('MUSEUM_CLEANUP_SECRET') || '';
const RATE_LIMIT_PEPPER = Deno.env.get('MUSEUM_RATE_LIMIT_PEPPER') || SERVICE_ROLE_KEY;

// R2 credentials live only in Edge Function secrets. Never log values, never
// expose them to the browser, and never put them in a presigned URL body.
const R2_CONFIG_RESULT = r2ConfigFromEnv(Deno.env.toObject());
const r2 = R2_CONFIG_RESULT.ok
  ? createR2Client(R2_CONFIG_RESULT.config)
  : null;

const ALLOWED_ORIGINS = (Deno.env.get('MUSEUM_ALLOWED_ORIGINS') || '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const CREATE_LIMIT = (() => {
  const value = Number(Deno.env.get('MUSEUM_CREATE_LIMIT_PER_HOUR') || 10);
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, Math.trunc(value)));
})();

const CLEANUP_BATCH = (() => {
  const value = Number(Deno.env.get('MUSEUM_CLEANUP_BATCH') || 25);
  if (!Number.isFinite(value)) return 25;
  return Math.max(1, Math.min(100, Math.trunc(value)));
})();

const MAX_BODY_BYTES = 64 * 1024;

const admin = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  let allowOrigin = 'null';

  if (ALLOWED_ORIGINS.includes('*')) {
    allowOrigin = '*';
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    allowOrigin = origin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function json(request, body, status = 200, extraHeaders = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function routePath(pathname) {
  const marker = `/${FUNCTION_SLUG}`;
  const index = pathname.indexOf(marker);
  const rest = index >= 0 ? pathname.slice(index + marker.length) : pathname;
  const trimmed = rest.replace(/\/+$/g, '');
  return trimmed || '/';
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'The request is too large.');
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'The request is too large.');
  }

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid', 'The request body must be valid JSON.');
  }
}

function requireAdmin() {
  if (!admin) {
    throw new HttpError(
      503,
      'unavailable',
      'Museums are not configured on this server yet.'
    );
  }
  return admin;
}

function requireStorage() {
  if (!r2) {
    throw new HttpError(
      503,
      'unavailable',
      'Photo storage is not configured on this server yet.'
    );
  }
  return r2;
}

function normalizeToken(value) {
  return typeof value === 'string' && value.length <= 200 ? value : '';
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0].trim();
  return first || request.headers.get('cf-connecting-ip') || 'unknown';
}

async function rateLimitHash(request) {
  return sha256Hex(`${clientIp(request)}|${RATE_LIMIT_PEPPER}`);
}

/**
 * Every object for one museum lives under a server-generated UUID prefix, e.g.
 * `museums/<uuid>/00-a1b2c3.jpg`. Listing is paginated defensively so a stray
 * object cannot hide from cleanup.
 */
async function listMuseumObjects(storage, museumId) {
  return storage.listObjects(`museums/${museumId}/`);
}

/**
 * Delete R2 objects for one museum. A missing object is already deleted, so
 * the operation is idempotent. Individual deletes are retried once inside the
 * client; any remaining failure is thrown so the caller keeps the database row
 * for the next scheduled run instead of orphaning bytes.
 */
async function removeMuseumObjects(storage, museumId) {
  const objects = await listMuseumObjects(storage, museumId);
  let removed = 0;

  for (const object of objects) {
    const result = await storage.deleteObject(object.key);
    if (result.deleted) removed += 1;
  }

  return removed;
}

async function createMuseum(request) {
  const client = requireAdmin();
  const storage = requireStorage();
  const body = await readJson(request);
  const validation = validateMuseumInput(body);

  if (!validation.ok) {
    throw new HttpError(400, 'invalid', 'Please check the museum details.', {
      errors: validation.errors,
      fields: validation.fields,
    });
  }

  const value = validation.value;
  const ipHash = await rateLimitHash(request);

  const { data: allowed, error: rateError } = await client.rpc('consume_creation_slot', {
    p_ip_hash: ipHash,
    p_limit: CREATE_LIMIT,
  });

  if (rateError) {
    console.error(`[museum-api] rate limit unavailable: ${rateError.message}`);
    throw new HttpError(503, 'unavailable', 'Museums are temporarily unavailable.');
  }

  if (!allowed) {
    throw new HttpError(
      429,
      'rate_limited',
      'Too many museums were created from this connection. Please try again later.'
    );
  }

  const museumId = crypto.randomUUID();
  const publicId = createPublicId();
  const completionToken = createCompletionToken();
  const completionTokenHash = await sha256Hex(completionToken);

  const paths = value.photos.map((photo) => {
    const extension = CONTENT_TYPE_EXTENSIONS[photo.contentType] || 'jpg';
    const position = String(photo.position).padStart(2, '0');
    return `museums/${museumId}/${position}-${randomToken(6)}.${extension}`;
  });

  const { data: museum, error: museumError } = await client
    .from('museums')
    .insert({
      id: museumId,
      public_id: publicId,
      title: value.title,
      recipient_name: value.recipient,
      dedication: value.dedication,
      final_message: value.finalMessage,
      completion_token_hash: completionTokenHash,
    })
    .select('id, public_id, created_at, expires_at')
    .single();

  if (museumError || !museum) {
    console.error(`[museum-api] could not create museum: ${museumError?.message || 'no row'}`);
    throw new HttpError(500, 'server_error', 'The museum could not be created. Please try again.');
  }

  const photoRows = value.photos.map((photo, index) => ({
    museum_id: museumId,
    position: photo.position,
    storage_path: paths[index],
    content_type: photo.contentType,
    byte_size: photo.byteSize,
    width: photo.width,
    height: photo.height,
    caption: photo.caption,
    date_label: photo.dateLabel,
  }));

  const { error: photosError } = await client.from('museum_photos').insert(photoRows);
  if (photosError) {
    await client.from('museums').delete().eq('id', museumId);
    console.error(`[museum-api] could not create photo rows: ${photosError.message}`);
    throw new HttpError(500, 'server_error', 'The museum could not be created. Please try again.');
  }

  const uploads = [];
  try {
    for (let index = 0; index < paths.length; index += 1) {
      const signedUrl = await storage.presignPut(paths[index], {
        contentType: value.photos[index].contentType,
        expiresIn: R2_UPLOAD_TTL_SECONDS,
      });

      uploads.push({
        position: index,
        path: paths[index],
        signedUrl,
      });
    }
  } catch (error) {
    await client.from('museums').delete().eq('id', museumId);
    console.error(`[museum-api] could not presign upload: ${error?.message || 'unknown error'}`);
    throw new HttpError(500, 'server_error', 'Uploads could not be prepared. Please try again.');
  }

  return json(request, {
    museumId,
    completionToken,
    expiresAt: museum.expires_at,
    uploads,
  }, 201);
}

async function completeMuseum(request, museumId) {
  const client = requireAdmin();
  const body = await readJson(request);
  const token = normalizeToken(body.token);

  const { data: museum, error } = await client
    .from('museums')
    .select('id, public_id, ready_at, expires_at, completion_token_hash')
    .eq('id', museumId)
    .maybeSingle();

  if (error) throw error;
  if (!museum) throw new HttpError(404, 'not_found', 'This museum could not be found.');

  const tokenHash = await sha256Hex(token);
  if (!safeEqual(tokenHash, museum.completion_token_hash)) {
    throw new HttpError(403, 'forbidden', 'This creation session is no longer valid.');
  }

  if (isExpired(museum.expires_at)) {
    throw new HttpError(410, 'expired', 'This museum has expired.');
  }

  if (museum.ready_at) {
    return json(request, {
      publicId: museum.public_id,
      expiresAt: museum.expires_at,
      alreadyReady: true,
    });
  }

  const { data: photos, error: photosError } = await client
    .from('museum_photos')
    .select('position, storage_path, content_type, byte_size')
    .eq('museum_id', museumId)
    .order('position', { ascending: true });

  if (photosError) throw photosError;

  const rows = Array.isArray(photos) ? photos : [];
  if (rows.length < MUSEUM_LIMITS.minPhotos || rows.length > MUSEUM_LIMITS.maxPhotos) {
    throw new HttpError(409, 'incomplete', 'The museum does not have the required number of photographs.');
  }

  // Verify every object with a HEAD request. The presigned PUT signed the
  // exact content type, and finalize independently checks both size and type
  // before the museum can become readable.
  const storage = requireStorage();
  let objects;
  try {
    objects = await Promise.all(
      rows.map((photo) => storage.headObject(photo.storage_path))
    );
  } catch (error) {
    console.error(`[museum-api] could not verify R2 objects: ${error?.message || 'unknown error'}`);
    throw new HttpError(
      503,
      'unavailable',
      'The photographs could not be verified. Please try again.'
    );
  }

  const missing = [];

  for (let index = 0; index < rows.length; index += 1) {
    const photo = rows[index];
    const object = objects[index];
    const objectType = String(object.contentType || '').toLowerCase();

    if (
      !object.exists ||
      object.size !== Number(photo.byte_size) ||
      objectType !== String(photo.content_type).toLowerCase()
    ) {
      missing.push(photo.position);
    }
  }

  if (missing.length > 0) {
    throw new HttpError(
      409,
      'incomplete',
      'Some photographs did not finish uploading. Please try again.',
      { positions: missing }
    );
  }

  const { data: updated, error: updateError } = await client
    .from('museums')
    .update({ ready_at: new Date().toISOString() })
    .eq('id', museumId)
    .is('ready_at', null)
    .select('public_id, expires_at')
    .maybeSingle();

  if (updateError) {
    console.error(`[museum-api] could not finalize museum: ${updateError.message}`);
    throw new HttpError(500, 'server_error', 'The museum could not be finished. Please try again.');
  }

  if (!updated) {
    // A concurrent finalize won the race. Treat it as success if it is ready.
    const { data: current } = await client
      .from('museums')
      .select('public_id, expires_at, ready_at')
      .eq('id', museumId)
      .maybeSingle();

    if (!current?.ready_at) {
      throw new HttpError(409, 'incomplete', 'The museum could not be finished. Please try again.');
    }

    return json(request, {
      publicId: current.public_id,
      expiresAt: current.expires_at,
      alreadyReady: true,
    });
  }

  return json(request, {
    publicId: updated.public_id,
    expiresAt: updated.expires_at,
  });
}

async function abortMuseum(request, museumId) {
  const client = requireAdmin();
  const body = await readJson(request);
  const token = normalizeToken(body.token);

  const { data: museum, error } = await client
    .from('museums')
    .select('id, ready_at, completion_token_hash')
    .eq('id', museumId)
    .maybeSingle();

  if (error) throw error;
  if (!museum) return json(request, null, 204);

  const tokenHash = await sha256Hex(token);
  if (!safeEqual(tokenHash, museum.completion_token_hash)) {
    throw new HttpError(403, 'forbidden', 'This creation session is no longer valid.');
  }

  if (museum.ready_at) {
    throw new HttpError(409, 'already_ready', 'This museum has already been shared and cannot be aborted.');
  }

  const storage = requireStorage();
  await removeMuseumObjects(storage, museumId);

  const { error: deleteError } = await client.from('museums').delete().eq('id', museumId);
  if (deleteError) throw deleteError;

  return json(request, null, 204);
}

async function readMuseum(request, publicId) {
  const client = requireAdmin();

  if (!isPublicId(publicId)) {
    throw new HttpError(404, 'not_found', 'This museum could not be found.');
  }

  const { data: museum, error } = await client
    .from('museums')
    .select(
      'public_id, title, recipient_name, dedication, final_message, created_at, expires_at, ready_at, museum_photos(position, storage_path, width, height, caption, date_label)'
    )
    .eq('public_id', publicId)
    .maybeSingle();

  if (error) throw error;
  if (!museum || !museum.ready_at) {
    throw new HttpError(404, 'not_found', 'This museum could not be found.');
  }

  if (isExpired(museum.expires_at)) {
    throw new HttpError(410, 'expired', 'This museum has closed.');
  }

  const photos = sortPhotos(museum.museum_photos);
  if (photos.length === 0) {
    throw new HttpError(503, 'unavailable', 'This museum is not ready yet. Please try again.');
  }

  // Never let a signed URL outlive the museum itself. Without this, a museum
  // fetched moments before expiry would keep serving its photographs for the
  // full signed-URL TTL even though new reads are refused.
  const remainingSeconds = Math.floor(
    (new Date(museum.expires_at).getTime() - Date.now()) / 1000
  );
  const signedUrlTtl = Math.max(
    1,
    Math.min(R2_DOWNLOAD_TTL_SECONDS, remainingSeconds)
  );

  const storage = requireStorage();
  let normalizedPhotos;
  try {
    normalizedPhotos = await Promise.all(
      photos.map(async (photo) => ({
        position: photo.position,
        url: await storage.presignGet(photo.storage_path, { expiresIn: signedUrlTtl }),
        width: photo.width,
        height: photo.height,
        caption: photo.caption || '',
        date: photo.date_label || '',
      }))
    );
  } catch (error) {
    console.error(`[museum-api] could not presign photo URLs: ${error?.message || 'unknown error'}`);
    throw new HttpError(503, 'unavailable', 'The photographs are temporarily unavailable. Please try again.');
  }

  return json(request, {
    museum: {
      publicId: museum.public_id,
      title: museum.title,
      recipient: museum.recipient_name,
      dedication: museum.dedication || '',
      finalMessage: museum.final_message || '',
      createdAt: museum.created_at,
      expiresAt: museum.expires_at,
      photos: normalizedPhotos,
    },
  });
}

async function cleanup(request) {
  const client = requireAdmin();

  if (!CLEANUP_SECRET || CLEANUP_SECRET.length < 24) {
    throw new HttpError(503, 'unavailable', 'Cleanup is not configured.');
  }

  const provided = request.headers.get('x-cleanup-secret') || '';
  if (!safeEqual(provided, CLEANUP_SECRET)) {
    throw new HttpError(401, 'unauthorized', 'A valid cleanup secret is required.');
  }

  // Never delete database rows if photo storage is unavailable: that would
  // orphan bytes permanently. Cleanup refuses the run instead, leaving every
  // row for the next hourly retry.
  const storage = requireStorage();
  const now = new Date();

  const store = {
    async listExpired(nowIso, limit) {
      const { data, error } = await client
        .from('museums')
        .select('id, public_id, created_at, expires_at, ready_at')
        .lte('expires_at', nowIso)
        .order('expires_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },

    async listAbandoned(cutoffIso, limit) {
      const { data, error } = await client
        .from('museums')
        .select('id, public_id, created_at, expires_at, ready_at')
        .is('ready_at', null)
        .lte('created_at', cutoffIso)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },

    async listObjectPaths(museumId) {
      const objects = await listMuseumObjects(storage, museumId);
      return objects.map((object) => object.key);
    },

    async removeObjects(paths) {
      for (const path of paths) {
        await storage.deleteObject(path);
      }
    },

    async deleteMuseum(museumId) {
      const { error } = await client.from('museums').delete().eq('id', museumId);
      if (error) throw error;
    },
  };

  const summary = await runMuseumCleanup(store, {
    now,
    batchSize: CLEANUP_BATCH,
    graceMs: 60 * 60 * 1000,
  });

  return json(request, { ok: summary.failed === 0, ...summary });
}

async function handleRequest(request) {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const path = routePath(url.pathname);
  const parts = path.split('/').filter(Boolean);

  try {
    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      const databaseReady = Boolean(admin);
      const storageReady = Boolean(r2);
      const configured = databaseReady && storageReady;

      let message = 'Ready.';
      if (!databaseReady && !storageReady) {
        message = 'Supabase and R2 credentials are missing.';
      } else if (!databaseReady) {
        message = 'Supabase credentials are missing.';
      } else if (!storageReady) {
        message = 'R2 credentials are missing.';
      }

      return json(request, {
        ok: configured,
        service: 'museum-api',
        storage: storageReady ? 'r2' : 'missing',
        message,
      }, configured ? 200 : 503);
    }

    if (parts[0] === 'museums') {
      if (parts.length === 1 && request.method === 'POST') {
        return await createMuseum(request);
      }

      if (parts.length === 2 && request.method === 'GET') {
        return await readMuseum(request, parts[1]);
      }

      if (parts.length === 3 && request.method === 'POST' && parts[2] === 'complete') {
        return await completeMuseum(request, parts[1]);
      }

      if (parts.length === 3 && request.method === 'POST' && parts[2] === 'abort') {
        return await abortMuseum(request, parts[1]);
      }
    }

    if (path === '/cleanup' && request.method === 'POST') {
      return await cleanup(request);
    }

    throw new HttpError(404, 'not_found', 'Not found.');
  } catch (error) {
    if (error instanceof HttpError) {
      return json(request, {
        error: error.code,
        message: error.message,
        ...error.extra,
      }, error.status);
    }

    console.error(`[museum-api] ${request.method} ${path}: ${error?.message || 'unknown error'}`);
    return json(request, {
      error: 'server_error',
      message: 'Something went wrong. Please try again.',
    }, 500);
  }
}

Deno.serve(handleRequest);
