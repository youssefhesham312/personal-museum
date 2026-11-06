import { describe, expect, it, vi } from 'vitest';
import {
  MuseumApiError,
  abortMuseum,
  checkMuseumApiHealth,
  completeMuseum,
  createMuseumDraft,
  fetchSharedMuseum,
  friendlyMuseumError,
} from './api.js';

const CONFIG = {
  url: 'https://example.supabase.co',
  anonKey: 'anon-key',
};

function response(status, payload, { raw = false } = {}) {
  const body = raw
    ? String(payload)
    : payload === undefined
      ? ''
      : JSON.stringify(payload);

  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function fetchReturning(status, payload, options) {
  return vi.fn(async () => response(status, payload, options));
}

function lastCall(fetchImpl) {
  return fetchImpl.mock.calls[0];
}

describe('request wiring', () => {
  it('sends the public key, JSON body and the Edge Function URL', async () => {
    const fetchImpl = fetchReturning(201, { museumId: 'draft-1' });
    await createMuseumDraft({ title: 'A museum' }, { config: CONFIG, fetchImpl });

    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe('https://example.supabase.co/functions/v1/museum-api/museums');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({
      apikey: 'anon-key',
      Authorization: 'Bearer anon-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({ title: 'A museum' });
  });

  it('does not send a body or content type for GET requests', async () => {
    const fetchImpl = fetchReturning(200, { museum: { publicId: 'x' } });
    await fetchSharedMuseum('abc', { config: CONFIG, fetchImpl });

    const [url, init] = lastCall(fetchImpl);
    expect(url).toBe('https://example.supabase.co/functions/v1/museum-api/museums/abc');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('encodes ids in complete, abort and read paths', async () => {
    const fetchImpl = fetchReturning(200, {});
    await completeMuseum({ museumId: 'a b/c', token: 't' }, { config: CONFIG, fetchImpl });
    expect(lastCall(fetchImpl)[0]).toBe(
      'https://example.supabase.co/functions/v1/museum-api/museums/a%20b%2Fc/complete'
    );

    fetchImpl.mockClear();
    await abortMuseum({ museumId: 'a b/c', token: 't' }, { config: CONFIG, fetchImpl });
    expect(lastCall(fetchImpl)[0]).toBe(
      'https://example.supabase.co/functions/v1/museum-api/museums/a%20b%2Fc/abort'
    );
    expect(JSON.parse(lastCall(fetchImpl)[1].body)).toEqual({ token: 't' });

    fetchImpl.mockClear();
    await fetchSharedMuseum('a b/c', { config: CONFIG, fetchImpl });
    expect(lastCall(fetchImpl)[0]).toBe(
      'https://example.supabase.co/functions/v1/museum-api/museums/a%20b%2Fc'
    );
  });

  it('calls the health endpoint', async () => {
    const fetchImpl = fetchReturning(200, { ok: true });
    await checkMuseumApiHealth({ config: CONFIG, fetchImpl });
    expect(lastCall(fetchImpl)[0]).toBe(
      'https://example.supabase.co/functions/v1/museum-api/health'
    );
  });

  it('returns null for an empty successful response', async () => {
    const fetchImpl = fetchReturning(204, undefined);
    await expect(fetchSharedMuseum('abc', { config: CONFIG, fetchImpl })).resolves.toBeNull();
  });

  it('returns null when a successful response is not JSON', async () => {
    const fetchImpl = fetchReturning(200, '<html>', { raw: true });
    await expect(fetchSharedMuseum('abc', { config: CONFIG, fetchImpl })).resolves.toBeNull();
  });
});

describe('error mapping', () => {
  const cases = [
    {
      status: 400,
      payload: { error: 'invalid', fields: { title: 'Required.' }, errors: ['Bad title'] },
      code: 'invalid',
      message: 'Please check the museum details.',
      property: 'fields',
      value: { title: 'Required.' },
    },
    {
      status: 404,
      payload: { error: 'not_found' },
      code: 'not_found',
      message: 'This museum could not be found.',
    },
    {
      status: 410,
      payload: { error: 'expired' },
      code: 'expired',
      message: 'This museum has closed.',
    },
    {
      status: 409,
      payload: { error: 'incomplete', positions: [1, 3] },
      code: 'incomplete',
      message: 'Some photographs did not finish uploading.',
      property: 'positions',
      value: [1, 3],
    },
    {
      status: 409,
      payload: { error: 'already_ready' },
      code: 'already_ready',
      message: 'This museum has already been shared.',
    },
    {
      status: 403,
      payload: { error: 'forbidden' },
      code: 'forbidden',
      message: 'This creation session is no longer valid.',
    },
    {
      status: 429,
      payload: { error: 'rate_limited' },
      code: 'rate_limited',
      message: 'Too many museums were created from this connection. Please try again later.',
    },
    {
      status: 503,
      payload: { error: 'unavailable' },
      code: 'unavailable',
      message: 'Museums are temporarily unavailable. Please try again.',
    },
    {
      status: 500,
      payload: { error: 'server_error' },
      code: 'server',
      message: 'Something went wrong. Please try again.',
    },
    {
      status: 418,
      payload: null,
      code: 'server',
      message: 'Something went wrong. Please try again.',
    },
  ];

  for (const testCase of cases) {
    it(`maps HTTP ${testCase.status} / ${testCase.payload?.error ?? 'unknown'}`, async () => {
      const fetchImpl = fetchReturning(testCase.status, testCase.payload);
      const promise = fetchSharedMuseum('abc', { config: CONFIG, fetchImpl });

      await expect(promise).rejects.toMatchObject({
        name: 'MuseumApiError',
        code: testCase.code,
        status: testCase.status,
        message: testCase.message,
      });

      if (testCase.property) {
        const error = await promise.catch((reason) => reason);
        expect(error[testCase.property]).toEqual(testCase.value);
      }
    });
  }
});

describe('network and cancellation', () => {
  it('maps a connection failure to a friendly network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await fetchSharedMuseum('abc', { config: CONFIG, fetchImpl })
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(MuseumApiError);
    expect(error.code).toBe('network');
    expect(error.message).toMatch(/could not be reached/);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('times out a hanging request', async () => {
    const fetchImpl = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    const error = await fetchSharedMuseum('abc', {
      config: CONFIG,
      fetchImpl,
      timeoutMs: 5,
    }).catch((reason) => reason);

    expect(error.code).toBe('network');
    expect(error.message).toMatch(/timed out/);
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    const error = await fetchSharedMuseum('abc', {
      config: CONFIG,
      fetchImpl,
      signal: controller.signal,
    }).catch((reason) => reason);

    expect(error.code).toBe('cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels an in-flight request when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    const promise = fetchSharedMuseum('abc', {
      config: CONFIG,
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();

    const error = await promise.catch((reason) => reason);
    expect(error.code).toBe('cancelled');
    expect(error.message).toBe('Cancelled.');
  });
});

describe('friendlyMuseumError', () => {
  it('explains missing and expired museums', () => {
    expect(friendlyMuseumError(new MuseumApiError('not_found', ''))).toMatch(/could not be found/);
    expect(friendlyMuseumError(new MuseumApiError('expired', ''))).toMatch(/seven days/);
  });

  it('joins validation errors', () => {
    expect(friendlyMuseumError(new MuseumApiError('invalid', 'Please check.', {
      errors: ['One', 'Two'],
    }))).toBe('One Two');
    expect(friendlyMuseumError(new MuseumApiError('invalid', 'Please check.')))
      .toBe('Please check.');
  });

  it('handles photo optimisation and unknown errors', () => {
    expect(friendlyMuseumError({ name: 'PhotoOptimisationError', message: 'Try a smaller image.' }))
      .toBe('Try a smaller image.');
    expect(friendlyMuseumError(new Error('boom')))
      .toBe('Something went wrong. Please try again.');
    expect(friendlyMuseumError(null)).toBe('Something went wrong. Please try again.');
  });

  it('uses the specific message for rate limits and outages', () => {
    expect(friendlyMuseumError(new MuseumApiError('rate_limited', 'Slow down.'))).toBe('Slow down.');
    expect(friendlyMuseumError(new MuseumApiError('unavailable', 'Try later.'))).toBe('Try later.');
    expect(friendlyMuseumError(new MuseumApiError('network', 'No connection.'))).toBe('No connection.');
    expect(friendlyMuseumError(new MuseumApiError('upload_failed', 'This photograph is too large.')))
      .toBe('This photograph is too large.');
  });
});
