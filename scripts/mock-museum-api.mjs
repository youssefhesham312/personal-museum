/**
 * Local, in-memory stand-in for the museum-api Edge Function.
 *
 * This is a development and UI-verification tool. It is NOT a deployment
 * target and it has none of the production security controls: there is no
 * authentication, no rate limiting, no RLS, no real R2 presigned URLs and no
 * seven-day cleanup. Use it to exercise the creator form, uploads, share
 * links and error pages in a browser without Supabase or Cloudflare R2.
 *
 *   node scripts/mock-museum-api.mjs
 *   VITE_SUPABASE_URL=http://127.0.0.1:54321 \
 *   VITE_SUPABASE_ANON_KEY=local-anon \
 *   npm run dev
 *
 * Reserved links for error-state checks:
 *   /m/AAAAAAAAAAAAAAAAAAAAAA  -> expired (410)
 *   /m/BBBBBBBBBBBBBBBBBBBBBB  -> not found (404)
 */

import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 54321);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const MAX_BODY = 8 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PHOTOS = 5;
const MAX_PHOTOS = 15;

const EXPIRED_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const MISSING_ID = 'BBBBBBBBBBBBBBBBBBBBBB';

/** @type {Map<string, object>} museumId -> museum */
const museums = new Map();
/** @type {Map<string, string>} publicId -> museumId */
const publicIds = new Map();
/** @type {Map<string, string>} upload token -> museumId */
const uploadTokens = new Map();
/** @type {Map<string, {buffer: Buffer, type: string}>} upload id -> bytes */
const photos = new Map();

function publicId() {
  return randomBytes(16).toString('base64url');
}

function cors(request) {
  return {
    'Access-Control-Allow-Origin': request.headers.origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-secret',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}

function send(request, response, status, body, type = 'application/json; charset=utf-8') {
  const payload = body === null || body === undefined
    ? ''
    : typeof body === 'string' || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);

  response.writeHead(status, {
    ...cors(request),
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
  console.log(`[mock-api] ${request.method} ${request.url} -> ${status}`);
}

function fail(request, response, status, error, message) {
  send(request, response, status, { error, message });
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(request) {
  const buffer = await readBody(request);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

function cleanLine(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanBlock(value, max) {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).join('\n').slice(0, max).trim()
    : '';
}

function createMuseum(request, response, body) {
  const title = cleanLine(body.title, 200);
  const recipient = cleanLine(body.recipient, 200);
  const finalMessage = cleanBlock(body.finalMessage, 4000);
  const rawPhotos = Array.isArray(body.photos) ? body.photos : [];

  if (!title || !recipient || !finalMessage) {
    return fail(request, response, 400, 'invalid', 'Please check the museum details.');
  }
  if (rawPhotos.length < MIN_PHOTOS || rawPhotos.length > MAX_PHOTOS) {
    return fail(request, response, 400, 'invalid', `Add between ${MIN_PHOTOS} and ${MAX_PHOTOS} photos.`);
  }

  const id = randomUUID();
  const shareId = publicId();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();

  const museum = {
    id,
    publicId: shareId,
    completionToken: token,
    title,
    recipient,
    dedication: cleanBlock(body.dedication, 2000),
    finalMessage,
    createdAt: new Date().toISOString(),
    expiresAt,
    readyAt: null,
    photos: rawPhotos.map((photo, index) => ({
      position: index,
      contentType: String(photo.contentType || 'image/jpeg').toLowerCase(),
      byteSize: Number(photo.byteSize) || 0,
      width: Number(photo.width) || 1,
      height: Number(photo.height) || 1,
      caption: cleanLine(photo.caption, 400),
      date: cleanLine(photo.dateLabel, 120),
      upload: null,
    })),
  };

  museums.set(id, museum);
  publicIds.set(shareId, id);

  const uploads = museum.photos.map((photo, index) => {
    const uploadId = randomUUID();
    uploadTokens.set(uploadId, id);
    photo.upload = uploadId;
    return {
      position: index,
      path: `museums/${id}/${String(index).padStart(2, '0')}.${photo.contentType.split('/')[1]}`,
      signedUrl: `${BASE}/mock-storage/${uploadId}`,
      token: uploadId,
    };
  });

  return send(request, response, 201, {
    museumId: id,
    completionToken: token,
    expiresAt,
    uploads,
  });
}

function completeMuseum(request, response, museumId, body) {
  const museum = museums.get(museumId);
  if (!museum) return fail(request, response, 404, 'not_found', 'This museum could not be found.');
  if (body.token !== museum.completionToken) {
    return fail(request, response, 403, 'forbidden', 'This creation session is no longer valid.');
  }
  if (museum.readyAt) {
    return send(request, response, 200, {
      publicId: museum.publicId,
      expiresAt: museum.expiresAt,
      alreadyReady: true,
    });
  }

  const missing = museum.photos
    .filter((photo) => !photos.has(photo.upload))
    .map((photo) => photo.position);

  if (missing.length > 0) {
    return send(request, response, 409, {
      error: 'incomplete',
      message: 'Some photographs did not finish uploading. Please try again.',
      positions: missing,
    });
  }

  museum.readyAt = new Date().toISOString();
  return send(request, response, 200, {
    publicId: museum.publicId,
    expiresAt: museum.expiresAt,
  });
}

function abortMuseum(request, response, museumId, body) {
  const museum = museums.get(museumId);
  if (!museum) return send(request, response, 204, null);
  if (body.token !== museum.completionToken) {
    return fail(request, response, 403, 'forbidden', 'This creation session is no longer valid.');
  }
  if (museum.readyAt) {
    return fail(request, response, 409, 'already_ready', 'This museum has already been shared.');
  }

  removeMuseum(museum);
  return send(request, response, 204, null);
}

function removeMuseum(museum) {
  for (const photo of museum.photos) {
    photos.delete(photo.upload);
    uploadTokens.delete(photo.upload);
  }
  publicIds.delete(museum.publicId);
  museums.delete(museum.id);
}

function readMuseum(request, response, shareId) {
  if (shareId === EXPIRED_ID) {
    return fail(request, response, 410, 'expired', 'This museum has closed.');
  }
  if (shareId === MISSING_ID) {
    return fail(request, response, 404, 'not_found', 'This museum could not be found.');
  }

  const museumId = publicIds.get(shareId);
  const museum = museumId ? museums.get(museumId) : null;

  if (!museum || !museum.readyAt) {
    return fail(request, response, 404, 'not_found', 'This museum could not be found.');
  }

  return send(request, response, 200, {
    museum: {
      publicId: museum.publicId,
      title: museum.title,
      recipient: museum.recipient,
      dedication: museum.dedication,
      finalMessage: museum.finalMessage,
      createdAt: museum.createdAt,
      expiresAt: museum.expiresAt,
      photos: museum.photos.map((photo) => ({
        position: photo.position,
        url: `${BASE}/mock-photos/${photo.upload}`,
        width: photo.width,
        height: photo.height,
        caption: photo.caption,
        date: photo.date,
      })),
    },
  });
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors(request));
    response.end();
    return;
  }

  const url = new URL(request.url || '/', BASE);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (request.method === 'GET' && path === '/functions/v1/museum-api/health') {
      return send(request, response, 200, { ok: true, service: 'museum-api', message: 'Mock ready.' });
    }

    if (request.method === 'GET' && path.startsWith('/mock-photos/')) {
      const id = path.slice('/mock-photos/'.length);
      const photo = photos.get(id);
      if (!photo) return fail(request, response, 404, 'not_found', 'Photo not found.');
      return send(request, response, 200, photo.buffer, photo.type);
    }

    if (request.method === 'PUT' && path.startsWith('/mock-storage/')) {
      const id = path.slice('/mock-storage/'.length);
      const museumId = uploadTokens.get(id);
      const museum = museumId ? museums.get(museumId) : null;
      const photo = museum?.photos.find((entry) => entry.upload === id);
      if (!museum || !photo) return fail(request, response, 404, 'not_found', 'Upload not found.');

      const buffer = await readBody(request);
      photos.set(id, {
        buffer,
        type: request.headers['content-type'] || photo.contentType,
      });
      return send(request, response, 200, {});
    }

    if (path === '/functions/v1/museum-api/museums' && request.method === 'POST') {
      return createMuseum(request, response, await readJson(request));
    }

    const museumRoute = /^\/functions\/v1\/museum-api\/museums\/([^/]+)(?:\/(complete|abort))?$/.exec(path);
    if (museumRoute) {
      const [, id, action] = museumRoute;

      if (action === 'complete' && request.method === 'POST') {
        return completeMuseum(request, response, id, await readJson(request));
      }

      if (action === 'abort' && request.method === 'POST') {
        return abortMuseum(request, response, id, await readJson(request));
      }

      if (!action && request.method === 'GET') {
        return readMuseum(request, response, id);
      }
    }

    if (path === '/functions/v1/museum-api/cleanup' && request.method === 'POST') {
      return fail(request, response, 401, 'unauthorized', 'The mock API does not implement cleanup.');
    }

    return fail(request, response, 404, 'not_found', 'Not found.');
  } catch (error) {
    if (error?.status === 413) {
      return fail(request, response, 413, 'payload_too_large', 'The request is too large.');
    }
    if (error?.status === 400) {
      return fail(request, response, 400, 'invalid', 'The request body must be valid JSON.');
    }
    console.error('[mock-api] unexpected error', error);
    return fail(request, response, 500, 'server_error', 'Something went wrong.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-api] listening on ${BASE}`);
  console.log('[mock-api] set VITE_SUPABASE_URL=' + BASE);
  console.log('[mock-api] set VITE_SUPABASE_ANON_KEY=local-anon');
  console.log(`[mock-api] expired link: ${BASE}/m/${EXPIRED_ID}`);
  console.log(`[mock-api] missing link: ${BASE}/m/${MISSING_ID}`);
});
