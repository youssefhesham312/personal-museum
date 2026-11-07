import { apiEndpoint, getBackendConfig } from './config.js';
import { getLanguage, t } from '../i18n.js';

export class MuseumApiError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'MuseumApiError';
    this.code = code;
    this.status = options.status ?? 0;
    this.fields = options.fields ?? null;
    this.errors = options.errors ?? null;
    this.positions = options.positions ?? null;
    this.cause = options.cause ?? null;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

function mapHttpError(status, payload) {
  const code = payload?.error;

  if (status === 400 && code === 'invalid') {
    return new MuseumApiError('invalid', 'Please check the museum details.', {
      status,
      fields: payload?.fields ?? null,
      errors: payload?.errors ?? null,
    });
  }

  if (status === 404 || code === 'not_found') {
    return new MuseumApiError('not_found', 'This museum could not be found.', { status });
  }

  if (status === 410 || code === 'expired') {
    return new MuseumApiError('expired', 'This museum has closed.', { status });
  }

  if (status === 409 && code === 'incomplete') {
    return new MuseumApiError('incomplete', 'Some photographs did not finish uploading.', {
      status,
      positions: payload?.positions ?? null,
    });
  }

  if (status === 409 && code === 'already_ready') {
    return new MuseumApiError('already_ready', 'This museum has already been shared.', { status });
  }

  if (status === 403) {
    return new MuseumApiError('forbidden', 'This creation session is no longer valid.', { status });
  }

  if (status === 429) {
    return new MuseumApiError(
      'rate_limited',
      'Too many museums were created from this connection. Please try again later.',
      { status }
    );
  }

  if (status === 503) {
    return new MuseumApiError(
      'unavailable',
      'Museums are temporarily unavailable. Please try again.',
      { status }
    );
  }

  return new MuseumApiError('server', 'Something went wrong. Please try again.', { status });
}

async function request(path, options = {}) {
  const config = options.config ?? getBackendConfig();
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const externalSignal = options.signal;

  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;

  const onExternalAbort = () => {
    externallyAborted = true;
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new MuseumApiError('cancelled', 'Cancelled.');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(apiEndpoint(config, path), {
      method: options.method ?? 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'omit',
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      throw mapHttpError(response.status, payload);
    }

    return payload;
  } catch (error) {
    if (error instanceof MuseumApiError) throw error;

    if (externallyAborted) {
      throw new MuseumApiError('cancelled', 'Cancelled.', { cause: error });
    }

    if (timedOut) {
      throw new MuseumApiError('network', 'The request timed out. Check your connection and try again.', {
        cause: error,
      });
    }

    throw new MuseumApiError('network', 'The museum service could not be reached. Check your connection and try again.', {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export function createMuseumDraft(input, options = {}) {
  return request('/museums', { ...options, method: 'POST', body: input });
}

export function completeMuseum({ museumId, token }, options = {}) {
  return request(`/museums/${encodeURIComponent(museumId)}/complete`, {
    ...options,
    method: 'POST',
    body: { token },
  });
}

export function abortMuseum({ museumId, token }, options = {}) {
  return request(`/museums/${encodeURIComponent(museumId)}/abort`, {
    ...options,
    method: 'POST',
    body: { token },
  });
}

export function fetchSharedMuseum(publicId, options = {}) {
  return request(`/museums/${encodeURIComponent(publicId)}`, options);
}

export function checkMuseumApiHealth(options = {}) {
  return request('/health', options);
}

/** Human-readable text for UI surfaces. Never includes server internals. */
export function friendlyMuseumError(error) {
  if (error instanceof MuseumApiError && getLanguage() === 'ar') {
    switch (error.code) {
      case 'not_found':
        return t('errors.notFound');
      case 'expired':
        return t('errors.expired');
      case 'incomplete':
        return t('errors.incomplete');
      case 'rate_limited':
        return t('errors.rateLimited');
      case 'forbidden':
        return t('errors.forbidden');
      case 'cancelled':
        return t('errors.cancelled');
      case 'invalid':
        return t('errors.checkDetails');
      case 'network':
      case 'unavailable':
        return t('errors.unavailable');
      case 'upload_failed':
        return t('errors.uploadFailed');
      default:
        return t('errors.genericCreate');
    }
  }

  if (error instanceof MuseumApiError) {
    switch (error.code) {
      case 'not_found':
        return 'This museum could not be found. The link may be mistyped, or the museum has been removed.';
      case 'expired':
        return 'This museum has closed. Museums stay open for seven days after they are created.';
      case 'incomplete':
        return 'Some photographs did not finish uploading. Please try again.';
      case 'rate_limited':
        return error.message;
      case 'forbidden':
        return 'This creation session is no longer valid. Please start a new museum.';
      case 'cancelled':
        return 'Cancelled.';
      case 'invalid':
        return error.errors?.length ? error.errors.join(' ') : error.message;
      case 'network':
      case 'unavailable':
      case 'upload_failed':
        return error.message;
      default:
        return 'The museum could not be created. Please try again.';
    }
  }

  if (error?.name === 'PhotoOptimisationError') return error.message;
  return 'Something went wrong. Please try again.';
}
