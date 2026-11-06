/**
 * Minimal Cloudflare R2 client using the S3-compatible API.
 *
 * The Edge Function is the only place that holds R2 credentials. Browsers get
 * short-lived presigned URLs: a PUT URL for one generated object key, or a GET
 * URL for one photo. The secret access key never leaves the function. The
 * access key id is necessarily part of the SigV4 query string.
 *
 * This module uses only Web Crypto, TextEncoder, URL and fetch so it can run in
 * Deno (the deployed Edge Function) and in Node/Vitest (unit tests).
 *
 * Notes:
 * - R2's signing region is `auto`.
 * - Requests use path-style URLs: https://<account>.r2.cloudflarestorage.com/
 *   <bucket>/<key>.
 * - Presigned PUT URLs sign the exact `Content-Type` header. The browser must
 *   send that same value, and the finalize step re-checks size and type with a
 *   HEAD request.
 * - Payloads are never sent through the function: uploads and downloads go
 *   directly between the browser and R2.
 */

export const R2_REGION = 'auto';
export const R2_SERVICE = 's3';
export const R2_UPLOAD_TTL_SECONDS = 15 * 60;
export const R2_DOWNLOAD_TTL_SECONDS = 60 * 60;
export const R2_MIN_TTL_SECONDS = 60;
export const R2_MAX_TTL_SECONDS = 60 * 60;

export const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export class R2Error extends Error {
  constructor(operation, status, code = 'r2_error', message = 'R2 request failed.') {
    super(message);
    this.name = 'R2Error';
    this.operation = operation;
    this.status = Number(status) || 0;
    this.code = code;
  }
}

function bytes(value) {
  return new TextEncoder().encode(String(value));
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(value) {
  return hex(await crypto.subtle.digest('SHA-256', bytes(value)));
}

/** RFC 3986 encoding, as required by SigV4 (encodeURIComponent leaves !'()*). */
export function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** 2026-10-28T12:34:56.789Z -> 20261028T123456Z */
export function formatAmzDate(date) {
  return new Date(date).toISOString().replace(/[:-]|\.\d{3}/g, '');
}

export function clampPresignTtl(value, fallback = R2_DOWNLOAD_TTL_SECONDS) {
  const numeric = Number(value);
  const ttl = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.max(R2_MIN_TTL_SECONDS, Math.min(R2_MAX_TTL_SECONDS, ttl));
}

/**
 * Read and validate R2 configuration.
 *
 * Required environment variables:
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *
 * Optional:
 *   R2_ENDPOINT  (defaults to https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com)
 *
 * The return value is intentionally explicit so a health check can name the
 * missing variables without ever printing their values.
 */
export function r2ConfigFromEnv(env = {}) {
  const get = (name) => String(env[name] ?? '').trim();

  const accountId = get('R2_ACCOUNT_ID');
  const accessKeyId = get('R2_ACCESS_KEY_ID');
  const secretAccessKey = get('R2_SECRET_ACCESS_KEY');
  const bucket = get('R2_BUCKET');
  const configuredEndpoint = get('R2_ENDPOINT');

  const missing = [];
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');

  if (missing.length > 0) {
    return {
      ok: false,
      config: null,
      missing,
      errors: [`Missing R2 environment variables: ${missing.join(', ')}`],
    };
  }

  const errors = [];

  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    errors.push('R2_ACCOUNT_ID must be the 32-character hexadecimal Cloudflare account id.');
  }

  if (!BUCKET_PATTERN.test(bucket)) {
    errors.push(
      'R2_BUCKET must be 3–63 lowercase letters, digits or hyphens and cannot start or end with a hyphen.'
    );
  }

  const endpoint =
    configuredEndpoint || `https://${accountId}.r2.cloudflarestorage.com`;

  let endpointUrl = null;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    errors.push('R2_ENDPOINT must be a valid absolute URL.');
  }

  if (endpointUrl) {
    const local =
      endpointUrl.hostname === 'localhost' || endpointUrl.hostname === '127.0.0.1';
    if (endpointUrl.protocol !== 'https:' && !local) {
      errors.push('R2_ENDPOINT must use https.');
    }
  }

  if (errors.length > 0) {
    return { ok: false, config: null, missing: [], errors };
  }

  return {
    ok: true,
    missing: [],
    errors: [],
    config: {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      endpoint: `${endpointUrl.origin}${endpointUrl.pathname.replace(/\/+$/, '')}`,
      region: R2_REGION,
    },
  };
}

function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    typeof secret === 'string' ? bytes(secret) : secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function hmac(secret, value) {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(value)));
}

async function signingKey(secret, dateStamp, region, service) {
  const dateKey = await hmac(`AWS4${secret}`, dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  const signingSecret = await hmac(serviceKey, 'aws4_request');
  return hmacKey(signingSecret);
}

function canonicalQueryString(params) {
  return Object.keys(params)
    .sort()
    .map(
      (name) =>
        `${encodeRfc3986(name)}=${encodeRfc3986(params[name] ?? '')}`
    )
    .join('&');
}

function normalizedHeaderValue(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

function canonicalHeaders(headers) {
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();

  const values = {};
  for (const [name, value] of Object.entries(headers)) {
    values[name.toLowerCase()] = normalizedHeaderValue(value);
  }

  return {
    names,
    signedHeaders: names.join(';'),
    value: `${names.map((name) => `${name}:${values[name]}`).join('\n')}\n`,
  };
}

/**
 * Presign one URL with SigV4 query-string authentication.
 *
 * `signedHeaders` are included in the signature and must be sent by the
 * browser with exactly the same values. `host` is added automatically and is
 * never returned as a header (fetch sets it from the URL).
 */
export async function presignAwsUrl({
  method = 'GET',
  url,
  signedHeaders = {},
  expiresIn = R2_DOWNLOAD_TTL_SECONDS,
  credentials,
  region = R2_REGION,
  service = R2_SERVICE,
  now = new Date(),
}) {
  const target = url instanceof URL ? url : new URL(url);
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
    throw new R2Error('presign', 0, 'r2_not_configured', 'R2 credentials are not configured.');
  }

  // SigV4 allows up to seven days. The R2 client methods below deliberately
  // clamp their own TTLs to one hour; this generic helper keeps the protocol
  // limit so known-vector tests and other callers behave correctly.
  const requestedTtl = Number(expiresIn);
  const ttl = Math.max(
    1,
    Math.min(7 * 24 * 60 * 60, Number.isFinite(requestedTtl) ? Math.trunc(requestedTtl) : R2_DOWNLOAD_TTL_SECONDS)
  );
  const headers = { host: target.host, ...signedHeaders };
  const canonical = canonicalHeaders(headers);
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${credentials.accessKeyId}/${scope}`;

  const queryParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttl),
    'X-Amz-SignedHeaders': canonical.signedHeaders,
  };

  // Keep any pre-existing query parameters (none are used today, but this
  // keeps the helper correct for response-content-disposition and similar).
  for (const [name, value] of target.searchParams.entries()) {
    queryParams[name] = value;
  }

  const query = canonicalQueryString(queryParams);
  const canonicalRequest = [
    method,
    target.pathname || '/',
    query,
    canonical.value,
    canonical.signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await signingKey(
    credentials.secretAccessKey,
    dateStamp,
    region,
    service
  );
  const signature = hex(await crypto.subtle.sign('HMAC', key, bytes(stringToSign)));

  return `${target.origin}${target.pathname}?${query}&X-Amz-Signature=${signature}`;
}

/**
 * Sign a normal request with an Authorization header. Used for HEAD, LIST and
 * DELETE operations that run inside the Edge Function. Returns the headers to
 * pass to fetch; never includes the secret.
 */
export async function signAwsRequest({
  method = 'GET',
  url,
  headers = {},
  payloadHash = EMPTY_SHA256,
  credentials,
  region = R2_REGION,
  service = R2_SERVICE,
  now = new Date(),
}) {
  const target = url instanceof URL ? url : new URL(url);
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
    throw new R2Error('sign', 0, 'r2_not_configured', 'R2 credentials are not configured.');
  }

  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const allHeaders = {
    ...headers,
    host: target.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  const canonical = canonicalHeaders(allHeaders);
  const query = canonicalQueryString(
    Object.fromEntries(target.searchParams.entries())
  );

  const canonicalRequest = [
    method,
    target.pathname || '/',
    query,
    canonical.value,
    canonical.signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await signingKey(
    credentials.secretAccessKey,
    dateStamp,
    region,
    service
  );
  const signature = hex(await crypto.subtle.sign('HMAC', key, bytes(stringToSign)));

  return {
    ...headers,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`,
  };
}

function safeErrorText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function responseError(operation, response) {
  let code = 'r2_error';
  let message = 'R2 request failed.';

  try {
    const text = await response.text();
    const codeMatch = /<Code>([\s\S]*?)<\/Code>/.exec(text);
    const messageMatch = /<Message>([\s\S]*?)<\/Message>/.exec(text);
    if (codeMatch) code = decodeXml(codeMatch[1]).slice(0, 80);
    if (messageMatch) message = decodeXml(messageMatch[1]);
    else if (text && !text.includes('<')) message = text;
  } catch {
    /* response body is optional */
  }

  return new R2Error(
    operation,
    response.status,
    code,
    safeErrorText(message) || 'R2 request failed.'
  );
}

function assertObjectKey(key) {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.includes('..') ||
    /[\u0000-\u001f]/.test(key)
  ) {
    throw new R2Error('key', 0, 'invalid_key', 'The R2 object key is invalid.');
  }
  return key;
}

/**
 * Create a small R2 client bound to one bucket.
 *
 * options.fetchImpl, options.now and options.retryDelayMs exist for tests.
 */
export function createR2Client(config, options = {}) {
  if (!config?.bucket || !config?.accessKeyId || !config?.secretAccessKey) {
    throw new R2Error('config', 0, 'r2_not_configured', 'R2 is not configured.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const retryDelayMs = Number.isFinite(options.retryDelayMs)
    ? Math.max(0, options.retryDelayMs)
    : 150;
  const maxDeleteRetries = Math.max(0, Math.trunc(options.maxDeleteRetries ?? 1));

  const endpoint = String(config.endpoint).replace(/\/+$/, '');
  const endpointUrl = new URL(endpoint);
  const basePath = endpointUrl.pathname.replace(/\/+$/, '');
  const credentials = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  };
  const region = config.region || R2_REGION;

  const bucketPath = `${basePath}/${encodeRfc3986(config.bucket)}`;

  const objectUrl = (key) =>
    new URL(
      `${endpoint}${bucketPath}/${String(key)
        .split('/')
        .map((part) => encodeRfc3986(part))
        .join('/')}`
    );

  const collectionUrl = (query = {}) => {
    const params = {};
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[name] = String(value);
      }
    }

    // Build the exact canonical query string that will be signed. Using
    // URLSearchParams here would encode spaces as `+`, which does not match
    // SigV4's `%20` canonical form for some continuation tokens.
    const search = canonicalQueryString(params);
    return new URL(`${endpoint}${bucketPath}${search ? `?${search}` : ''}`);
  };

  const signedFetch = async (operation, method, url, { signal, payloadHash } = {}) => {
    const headers = await signAwsRequest({
      method,
      url,
      credentials,
      region,
      payloadHash: payloadHash ?? EMPTY_SHA256,
      now: now(),
    });

    try {
      return await fetchImpl(url, { method, headers, signal });
    } catch (error) {
      throw new R2Error(operation, 0, 'network_error', safeErrorText(error?.message));
    }
  };

  const sleep = (ms) =>
    new Promise((resolve) => {
      if (ms <= 0) resolve();
      else setTimeout(resolve, ms);
    });

  return {
    bucket: config.bucket,
    endpoint,

    async presignPut(key, { contentType, expiresIn = R2_UPLOAD_TTL_SECONDS } = {}) {
      assertObjectKey(key);
      const type = String(contentType || '').trim().toLowerCase();
      if (!type) {
        throw new R2Error('presign_put', 0, 'invalid_content_type', 'A content type is required.');
      }

      return presignAwsUrl({
        method: 'PUT',
        url: objectUrl(key),
        signedHeaders: { 'content-type': type },
        expiresIn: clampPresignTtl(expiresIn, R2_UPLOAD_TTL_SECONDS),
        credentials,
        region,
        now: now(),
      });
    },

    async presignGet(key, { expiresIn = R2_DOWNLOAD_TTL_SECONDS } = {}) {
      assertObjectKey(key);

      // Downloads may be shorter than a minute: the caller clamps the URL to
      // the museum's remaining lifetime, which can be a few seconds just
      // before expiry. SigV4 accepts any positive X-Amz-Expires.
      const requested = Number(expiresIn);
      const ttl = Math.max(
        1,
        Math.min(
          R2_MAX_TTL_SECONDS,
          Number.isFinite(requested) ? Math.trunc(requested) : R2_DOWNLOAD_TTL_SECONDS
        )
      );

      return presignAwsUrl({
        method: 'GET',
        url: objectUrl(key),
        expiresIn: ttl,
        credentials,
        region,
        now: now(),
      });
    },

    async headObject(key, { signal } = {}) {
      assertObjectKey(key);
      const response = await signedFetch('head_object', 'HEAD', objectUrl(key), {
        signal,
      });

      if (response.status === 404) {
        return { exists: false, size: 0, contentType: '' };
      }

      if (!response.ok) throw await responseError('head_object', response);

      return {
        exists: true,
        size: Number(response.headers.get('content-length') || 0),
        contentType: String(response.headers.get('content-type') || '')
          .split(';')[0]
          .trim()
          .toLowerCase(),
      };
    },

    async listObjects(prefix, { signal, maxPages = 20 } = {}) {
      if (typeof prefix !== 'string' || prefix.startsWith('/')) {
        throw new R2Error('list', 0, 'invalid_prefix', 'The R2 prefix is invalid.');
      }

      const objects = [];
      let continuationToken = '';

      for (let page = 0; page < Math.max(1, Math.trunc(maxPages)); page += 1) {
        const url = collectionUrl({
          'list-type': '2',
          prefix,
          'max-keys': '1000',
          'continuation-token': continuationToken,
        });

        const response = await signedFetch('list_objects', 'GET', url, { signal });
        if (!response.ok) throw await responseError('list_objects', response);

        const xml = await response.text();
        for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const block = match[1];
          const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(block);
          if (!keyMatch) continue;

          const sizeMatch = /<Size>([\s\S]*?)<\/Size>/.exec(block);
          objects.push({
            key: decodeXml(keyMatch[1]),
            size: Number(sizeMatch?.[1] || 0),
          });
        }

        const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
        const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
        if (!truncated || !tokenMatch) break;
        continuationToken = decodeXml(tokenMatch[1]);
      }

      return objects;
    },

    async deleteObject(key, { signal } = {}) {
      assertObjectKey(key);

      for (let attempt = 0; attempt <= maxDeleteRetries; attempt += 1) {
        let response;
        try {
          response = await signedFetch('delete_object', 'DELETE', objectUrl(key), {
            signal,
          });
        } catch (error) {
          if (error?.status === 0 && attempt < maxDeleteRetries) {
            await sleep(retryDelayMs * (attempt + 1));
            continue;
          }
          throw error;
        }

        if (response.ok || response.status === 404) {
          return { deleted: response.ok };
        }

        const retryable =
          response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        if (retryable && attempt < maxDeleteRetries) {
          await sleep(retryDelayMs * (attempt + 1));
          continue;
        }

        throw await responseError('delete_object', response);
      }

      throw new R2Error('delete_object', 0, 'delete_failed', 'The R2 object could not be deleted.');
    },
  };
}
