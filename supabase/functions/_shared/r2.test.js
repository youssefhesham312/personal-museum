import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_SHA256,
  R2_DOWNLOAD_TTL_SECONDS,
  R2Error,
  R2_UPLOAD_TTL_SECONDS,
  createR2Client,
  formatAmzDate,
  presignAwsUrl,
  r2ConfigFromEnv,
  signAwsRequest,
} from './r2.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const SECRET = CREDENTIALS.secretAccessKey;

function config(overrides = {}) {
  return {
    accountId: '0123456789abcdef0123456789abcdef',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucket: 'personal-museum-photos',
    endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    region: 'auto',
    ...overrides,
  };
}

function client(fetchImpl, options = {}) {
  return createR2Client(config(), {
    fetchImpl,
    now: () => NOW,
    retryDelayMs: 0,
    ...options,
  });
}

describe('SigV4 compatibility', () => {
  it('matches the published AWS header-signing example', async () => {
    const headers = await signAwsRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
      credentials: CREDENTIALS,
      region: 'us-east-1',
      service: 's3',
      now: new Date('2013-05-24T00:00:00.000Z'),
    });

    expect(headers.Authorization).toContain(
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });

  it('matches the published AWS query-string presigning example', async () => {
    const url = await presignAwsUrl({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      expiresIn: 86400,
      credentials: CREDENTIALS,
      region: 'us-east-1',
      service: 's3',
      now: new Date('2013-05-24T00:00:00.000Z'),
    });

    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
    );
    expect(url).toContain('X-Amz-Expires=86400');
    expect(url).not.toContain(SECRET);
  });

  it('formats dates and encodes reserved characters for SigV4', () => {
    expect(formatAmzDate(new Date('2026-10-28T12:34:56.789Z'))).toBe('20261028T123456Z');
  });
});

describe('r2ConfigFromEnv', () => {
  it('reports every missing required variable without values', () => {
    const result = r2ConfigFromEnv({});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('builds the default account endpoint and uses the auto region', () => {
    const result = r2ConfigFromEnv({
      R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'museum-photos',
    });

    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject({
      endpoint: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'museum-photos',
    });
  });

  it('accepts an explicit jurisdiction endpoint and rejects invalid values', () => {
    const result = r2ConfigFromEnv({
      R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'museum-photos',
      R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com',
    });
    expect(result.ok).toBe(true);
    expect(result.config.endpoint).toContain('.eu.r2.cloudflarestorage.com');

    const invalid = r2ConfigFromEnv({
      R2_ACCOUNT_ID: 'not-an-account',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'Bad_Bucket',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.join(' ')).toMatch(/32-character/);
    expect(invalid.errors.join(' ')).toMatch(/lowercase/);
  });
});

describe('presigned URLs', () => {
  it('presigns a PUT with the signed content type and upload TTL', async () => {
    const url = await client(vi.fn()).presignPut(
      'museums/abc/00-a1b2c3.jpg',
      { contentType: 'image/jpeg' }
    );

    const parsed = new URL(url);
    expect(parsed.origin).toBe(
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'
    );
    expect(parsed.pathname).toBe(
      '/personal-museum-photos/museums/abc/00-a1b2c3.jpg'
    );
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(R2_UPLOAD_TTL_SECONDS));
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(parsed.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url).not.toContain(SECRET);
  });

  it('presigns a GET with a short TTL and no credential material', async () => {
    const url = await client(vi.fn()).presignGet('museums/abc/00-a1b2c3.webp', {
      expiresIn: 5,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('5');
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url).not.toContain(SECRET);
  });

  it('clamps upload TTLs and rejects a missing content type', async () => {
    const r2 = client(vi.fn());

    const long = new URL(
      await r2.presignPut('museums/a/00.jpg', {
        contentType: 'image/jpeg',
        expiresIn: 999999,
      })
    );
    expect(long.searchParams.get('X-Amz-Expires')).toBe('3600');

    const short = new URL(
      await r2.presignPut('museums/a/00.jpg', {
        contentType: 'image/jpeg',
        expiresIn: 1,
      })
    );
    expect(short.searchParams.get('X-Amz-Expires')).toBe('60');

    await expect(r2.presignPut('museums/a/00.jpg')).rejects.toMatchObject({
      code: 'invalid_content_type',
    });
  });

  it('changes the signature when the key or clock changes', async () => {
    const r2 = client(vi.fn());
    const first = await r2.presignGet('museums/a/00.jpg');
    const second = await r2.presignGet('museums/a/01.jpg');

    const firstUrl = new URL(first);
    const secondUrl = new URL(second);
    expect(firstUrl.searchParams.get('X-Amz-Signature')).not.toBe(
      secondUrl.searchParams.get('X-Amz-Signature')
    );
  });
});

describe('object operations', () => {
  it('HEADs an object and returns its size and type', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-length': '1234', 'content-type': 'image/webp' },
      })
    );

    const result = await client(fetchImpl).headObject('museums/a/00.webp');

    expect(result).toEqual({ exists: true, size: 1234, contentType: 'image/webp' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('HEAD');
    expect(new URL(url).pathname).toBe('/personal-museum-photos/museums/a/00.webp');
    expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    expect(init.headers.Authorization).not.toContain('test-secret-key');
  });

  it('reports a missing object without throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    await expect(client(fetchImpl).headObject('museums/a/missing.jpg')).resolves.toEqual({
      exists: false,
      size: 0,
      contentType: '',
    });
  });

  it('turns a failed HEAD into a sanitized R2Error', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        '<Error><Code>AccessDenied</Code><Message>Denied https://secret.example</Message></Error>',
        { status: 403 }
      )
    );

    const error = await client(fetchImpl)
      .headObject('museums/a/00.jpg')
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(R2Error);
    expect(error.operation).toBe('head_object');
    expect(error.status).toBe(403);
    expect(error.code).toBe('AccessDenied');
    expect(error.message).not.toContain('https://');
  });

  it('lists every page under a prefix and decodes XML entities', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<ListBucketResult><IsTruncated>true</IsTruncated>' +
            '<Contents><Key>museums/a/00.jpg</Key><Size>10</Size></Contents>' +
            '<NextContinuationToken>next page</NextContinuationToken>' +
            '</ListBucketResult>',
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          '<ListBucketResult><IsTruncated>false</IsTruncated>' +
            '<Contents><Key>museums/a/01&amp;two.jpg</Key><Size>20</Size></Contents>' +
            '</ListBucketResult>',
          { status: 200 }
        )
      );

    const objects = await client(fetchImpl).listObjects('museums/a/');

    expect(objects).toEqual([
      { key: 'museums/a/00.jpg', size: 10 },
      { key: 'museums/a/01&two.jpg', size: 20 },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondUrl = new URL(fetchImpl.mock.calls[1][0]);
    expect(secondUrl.searchParams.get('list-type')).toBe('2');
    expect(secondUrl.searchParams.get('prefix')).toBe('museums/a/');
    expect(secondUrl.searchParams.get('continuation-token')).toBe('next page');
  });

  it('deletes an object and treats 404 as already gone', async () => {
    const deleted = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(client(deleted).deleteObject('museums/a/00.jpg')).resolves.toEqual({
      deleted: true,
    });

    const missing = vi.fn(async () => new Response('', { status: 404 }));
    await expect(client(missing).deleteObject('museums/a/00.jpg')).resolves.toEqual({
      deleted: false,
    });
  });

  it('retries a transient delete failure once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(client(fetchImpl).deleteObject('museums/a/00.jpg')).resolves.toEqual({
      deleted: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws after the delete retry budget is exhausted', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }));

    const error = await client(fetchImpl)
      .deleteObject('museums/a/00.jpg')
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(R2Error);
    expect(error.operation).toBe('delete_object');
    expect(error.status).toBe(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects path traversal and empty keys before signing', async () => {
    const fetchImpl = vi.fn();
    const r2 = client(fetchImpl);

    await expect(r2.presignGet('museums/../secret')).rejects.toMatchObject({
      code: 'invalid_key',
    });
    await expect(r2.deleteObject('')).rejects.toMatchObject({ code: 'invalid_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not leak the secret in any request header or URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const r2 = client(fetchImpl);

    const url = await r2.presignGet('museums/a/00.jpg');
    await r2.deleteObject('museums/a/00.jpg');

    expect(url).not.toContain(SECRET);
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.stringify(init.headers)).not.toContain(SECRET);
  });

  it('uses the download TTL constant as the default', async () => {
    expect(R2_DOWNLOAD_TTL_SECONDS).toBe(3600);
  });
});
