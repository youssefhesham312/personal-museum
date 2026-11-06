/**
 * Opt-in integration test against a real Supabase project.
 *
 * It is skipped unless MUSEUM_INTEGRATION_URL is set, so `npm test` stays
 * hermetic. Run it with `npm run test:integration` after deploying the
 * migrations and Edge Function.
 *
 * Required:
 *   MUSEUM_INTEGRATION_URL=https://<project-ref>.supabase.co
 *
 * Optional:
 *   MUSEUM_INTEGRATION_ANON_KEY=<publishable/anon key>
 *
 * This test creates one real museum and leaves it to the scheduled cleanup
 * job, because a shared museum intentionally cannot be deleted early. Use a
 * development project, not production.
 */

import { describe, expect, it } from 'vitest';

const BASE_URL = (process.env.MUSEUM_INTEGRATION_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.MUSEUM_INTEGRATION_ANON_KEY || '';
const RUN = Boolean(BASE_URL);

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const FUNCTION_URL = `${BASE_URL}/functions/v1/museum-api`;

function apiHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
    ...extra,
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${FUNCTION_URL}${path}`, {
    ...options,
    headers: apiHeaders(options.headers),
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { response, body };
}

function createBody() {
  return {
    title: 'Integration Test Museum',
    recipient: 'Test Recipient',
    dedication: 'Created by the opt-in integration test.',
    finalMessage: 'If you can read this, retrieval works.',
    photos: Array.from({ length: 5 }, (_, index) => ({
      contentType: 'image/png',
      byteSize: PNG.length,
      width: 1,
      height: 1,
      caption: `Integration photo ${index + 1}`,
      dateLabel: '2026',
    })),
  };
}

describe.skipIf(!RUN)('museum-api against a real Supabase project', () => {
  it('reports healthy when Supabase and R2 are configured', async () => {
    const { response, body } = await api('/health');
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: 'museum-api', storage: 'r2' });
  });

  it('returns friendly errors for malformed and unknown ids', async () => {
    const malformed = await api('/museums/not-a-valid-id');
    expect(malformed.response.status).toBe(404);
    expect(malformed.body.error).toBe('not_found');

    const unknown = await api(`/museums/${'A'.repeat(22)}`);
    expect(unknown.response.status).toBe(404);
    expect(unknown.body.error).toBe('not_found');
  });

  it('creates, uploads, finalizes and retrieves a museum', async () => {
    const created = await api('/museums', {
      method: 'POST',
      body: JSON.stringify(createBody()),
    });

    expect(created.response.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.uploads).toHaveLength(5);
    expect(typeof created.body.museumId).toBe('string');
    expect(typeof created.body.completionToken).toBe('string');

    const lifetimeMs = Date.parse(created.body.expiresAt) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);

    for (const upload of created.body.uploads) {
      // R2 signs the exact Content-Type on the presigned PUT. No credentials
      // and no x-upsert header are sent by the browser.
      const response = await fetch(upload.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: PNG,
      });
      expect([200, 201, 204].includes(response.status), `upload ${upload.position}`).toBe(true);
    }

    const completed = await api(`/museums/${created.body.museumId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ token: created.body.completionToken }),
    });

    expect(completed.response.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(completed.body.expiresAt).toBe(created.body.expiresAt);

    const fetched = await api(`/museums/${completed.body.publicId}`);
    expect(fetched.response.status).toBe(200);
    expect(fetched.body.museum).toMatchObject({
      publicId: completed.body.publicId,
      title: 'Integration Test Museum',
      recipient: 'Test Recipient',
    });
    expect(fetched.body.museum.photos).toHaveLength(5);
    expect(fetched.body.museum.photos[0].url).toMatch(/^https?:\/\//);
    expect(fetched.body.museum.photos[0].caption).toBe('Integration photo 1');

    // The presigned GET must return the exact bytes without any credential
    // header. This is the live-R2 check; it is not run in the hermetic suite.
    const photoResponse = await fetch(fetched.body.museum.photos[0].url);
    expect(photoResponse.status).toBe(200);
    expect(photoResponse.headers.get('content-type')).toMatch(/^image\/png/);
    expect(Buffer.from(await photoResponse.arrayBuffer()).equals(PNG)).toBe(true);

    // A shared museum cannot be aborted or deleted by the creator.
    const aborted = await api(`/museums/${created.body.museumId}/abort`, {
      method: 'POST',
      body: JSON.stringify({ token: created.body.completionToken }),
    });
    expect(aborted.response.status).toBe(409);
    expect(aborted.body.error).toBe('already_ready');
  });

  it('refuses finalization when an R2 object is missing and then aborts', async () => {
    const created = await api('/museums', {
      method: 'POST',
      body: JSON.stringify(createBody()),
    });
    expect(created.response.status, JSON.stringify(created.body)).toBe(201);

    // Upload all but the last photo, then verify the server's HEAD checks
    // reject the incomplete set.
    for (const upload of created.body.uploads.slice(0, 4)) {
      const response = await fetch(upload.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: PNG,
      });
      expect([200, 201, 204].includes(response.status)).toBe(true);
    }

    const completed = await api(`/museums/${created.body.museumId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ token: created.body.completionToken }),
    });
    expect(completed.response.status).toBe(409);
    expect(completed.body.error).toBe('incomplete');
    expect(completed.body.positions).toEqual([4]);

    const aborted = await api(`/museums/${created.body.museumId}/abort`, {
      method: 'POST',
      body: JSON.stringify({ token: created.body.completionToken }),
    });
    expect(aborted.response.status).toBe(204);
  });

  it('aborts an unfinished draft', async () => {
    const created = await api('/museums', {
      method: 'POST',
      body: JSON.stringify(createBody()),
    });
    expect(created.response.status).toBe(201);

    const aborted = await api(`/museums/${created.body.museumId}/abort`, {
      method: 'POST',
      body: JSON.stringify({ token: created.body.completionToken }),
    });
    expect(aborted.response.status).toBe(204);
  });

  it('rejects a cleanup request without the secret', async () => {
    const result = await api('/cleanup', { method: 'POST', body: '{}' });
    // 503 means the operator did not configure cleanup at all.
    expect([401, 503]).toContain(result.response.status);
  });
});
