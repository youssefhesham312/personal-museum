/**
 * Browser configuration for the museum API.
 *
 * Only the public anon/publishable key belongs here. The service-role key is
 * used inside the Edge Function and must never be bundled into the client.
 */

export class MuseumConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MuseumConfigError';
    this.code = 'config';
  }
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Refuse a secret/service key even if someone pastes one into VITE_*.
 * This is a guardrail, not the security boundary (the key must still be kept
 * out of the bundle by configuration).
 */
export function assertPublicSupabaseKey(key) {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new MuseumConfigError('The Supabase public key is missing.');
  }

  const value = key.trim();
  if (/^sb_secret_/i.test(value) || /service_role/i.test(value)) {
    throw new MuseumConfigError(
      'A Supabase secret/service-role key was supplied to the browser. Use the public anon or publishable key only.'
    );
  }

  const payload = decodeJwtPayload(value);
  if (payload?.role === 'service_role') {
    throw new MuseumConfigError(
      'A Supabase service-role key was supplied to the browser. Use the public anon or publishable key only.'
    );
  }

  return value;
}

const PLACEHOLDER_URL = /your-project-ref|your-supabase-project|replace-with/i;
const PLACEHOLDER_KEY = /your-publishable-or-anon-key|your-anon-key|replace-with/i;

export function resolveBackendConfig(env = import.meta.env ?? {}) {
  const rawUrl = String(env.VITE_SUPABASE_URL || '').trim();
  const rawKey = String(env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!rawUrl || !rawKey) {
    throw new MuseumConfigError(
      'Sharing is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
    );
  }

  // `.env.example` values are convenient for documentation but must never be
  // treated as a working deployment. Without this guard a production build
  // silently points at a host that does not exist.
  if (PLACEHOLDER_URL.test(rawUrl) || PLACEHOLDER_KEY.test(rawKey)) {
    throw new MuseumConfigError(
      'Sharing is not configured. Replace the placeholder VITE_SUPABASE_* values with your project URL and public key.'
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MuseumConfigError('VITE_SUPABASE_URL is not a valid URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MuseumConfigError('VITE_SUPABASE_URL must use http or https.');
  }

  return {
    url: url.toString().replace(/\/+$/, ''),
    anonKey: assertPublicSupabaseKey(rawKey),
  };
}

export function isBackendConfigured(env = import.meta.env ?? {}) {
  try {
    resolveBackendConfig(env);
    return true;
  } catch {
    return false;
  }
}

let cached = null;

export function getBackendConfig(env = import.meta.env ?? {}) {
  if (!cached) cached = resolveBackendConfig(env);
  return cached;
}

/** Used by tests. */
export function _resetBackendConfigCache() {
  cached = null;
}

export function apiEndpoint(config, path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${config.url}/functions/v1/museum-api${suffix}`;
}
