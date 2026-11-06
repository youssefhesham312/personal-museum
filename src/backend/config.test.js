import { beforeEach, describe, expect, it } from 'vitest';
import {
  MuseumConfigError,
  _resetBackendConfigCache,
  apiEndpoint,
  assertPublicSupabaseKey,
  getBackendConfig,
  isBackendConfigured,
  resolveBackendConfig,
} from './config.js';

const URL_VALUE = 'https://example.supabase.co/';

function jwt(payload) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

const ANON_JWT = jwt({ role: 'anon', iss: 'supabase' });
const SERVICE_JWT = jwt({ role: 'service_role', iss: 'supabase' });

beforeEach(() => {
  _resetBackendConfigCache();
});

describe('assertPublicSupabaseKey', () => {
  it('accepts a normal anon JWT and a publishable key', () => {
    expect(assertPublicSupabaseKey(ANON_JWT)).toBe(ANON_JWT);
    expect(assertPublicSupabaseKey(' sb_publishable_abc ')).toBe('sb_publishable_abc');
  });

  it('rejects service-role JWTs', () => {
    expect(() => assertPublicSupabaseKey(SERVICE_JWT)).toThrow(MuseumConfigError);
    expect(() => assertPublicSupabaseKey(SERVICE_JWT)).toThrow(/service-role/);
  });

  it('rejects secret keys, including new sb_secret_ keys', () => {
    expect(() => assertPublicSupabaseKey('sb_secret_123')).toThrow(/secret\/service-role/);
    expect(() => assertPublicSupabaseKey('my_service_role_key')).toThrow(/secret\/service-role/);
  });

  it('rejects missing keys', () => {
    expect(() => assertPublicSupabaseKey('')).toThrow(/missing/);
    expect(() => assertPublicSupabaseKey(null)).toThrow(/missing/);
    expect(() => assertPublicSupabaseKey(42)).toThrow(/missing/);
  });
});

describe('resolveBackendConfig', () => {
  it('normalizes the project URL and keeps the public key', () => {
    expect(resolveBackendConfig({
      VITE_SUPABASE_URL: URL_VALUE,
      VITE_SUPABASE_ANON_KEY: ANON_JWT,
    })).toEqual({
      url: 'https://example.supabase.co',
      anonKey: ANON_JWT,
    });
  });

  it('trims whitespace', () => {
    const config = resolveBackendConfig({
      VITE_SUPABASE_URL: `  ${URL_VALUE}  `,
      VITE_SUPABASE_ANON_KEY: `  ${ANON_JWT}  `,
    });
    expect(config.url).toBe('https://example.supabase.co');
    expect(config.anonKey).toBe(ANON_JWT);
  });

  it('requires both values', () => {
    expect(() => resolveBackendConfig({})).toThrow(/not configured/);
    expect(() => resolveBackendConfig({ VITE_SUPABASE_URL: URL_VALUE })).toThrow(/not configured/);
    expect(() => resolveBackendConfig({ VITE_SUPABASE_ANON_KEY: ANON_JWT })).toThrow(/not configured/);
  });

  it('rejects the example placeholder values', () => {
    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      VITE_SUPABASE_ANON_KEY: ANON_JWT,
    })).toThrow(/placeholder/);

    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: URL_VALUE,
      VITE_SUPABASE_ANON_KEY: 'your-publishable-or-anon-key',
    })).toThrow(/placeholder/);
  });

  it('rejects malformed and non-http URLs', () => {
    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: 'not a url',
      VITE_SUPABASE_ANON_KEY: ANON_JWT,
    })).toThrow(/not a valid URL/);

    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: 'ftp://example.com',
      VITE_SUPABASE_ANON_KEY: ANON_JWT,
    })).toThrow(/http or https/);
  });

  it('rejects a secret key pasted into VITE_SUPABASE_ANON_KEY', () => {
    expect(() => resolveBackendConfig({
      VITE_SUPABASE_URL: URL_VALUE,
      VITE_SUPABASE_ANON_KEY: SERVICE_JWT,
    })).toThrow(MuseumConfigError);
  });

  it('supports a local http URL for development', () => {
    expect(resolveBackendConfig({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_local',
    }).url).toBe('http://127.0.0.1:54321');
  });
});

describe('isBackendConfigured', () => {
  it('is false for missing or unsafe configuration', () => {
    expect(isBackendConfigured({})).toBe(false);
    expect(isBackendConfigured({
      VITE_SUPABASE_URL: URL_VALUE,
      VITE_SUPABASE_ANON_KEY: SERVICE_JWT,
    })).toBe(false);
    expect(isBackendConfigured({
      VITE_SUPABASE_URL: 'https://your-project-ref.supabase.co',
      VITE_SUPABASE_ANON_KEY: ANON_JWT,
    })).toBe(false);
  });

  it('is true for usable configuration', () => {
    expect(isBackendConfigured({
      VITE_SUPABASE_URL: URL_VALUE,
      VITE_SUPABASE_ANON_KEY: ANON_JWT,
    })).toBe(true);
  });
});

describe('getBackendConfig', () => {
  it('caches a successful resolution until reset', () => {
    const env = { VITE_SUPABASE_URL: URL_VALUE, VITE_SUPABASE_ANON_KEY: ANON_JWT };
    const first = getBackendConfig(env);
    const second = getBackendConfig({});
    expect(second).toBe(first);

    _resetBackendConfigCache();
    expect(() => getBackendConfig({})).toThrow(MuseumConfigError);
  });
});

describe('apiEndpoint', () => {
  it('builds the Edge Function URL with a single slash', () => {
    const config = { url: 'https://example.supabase.co' };
    expect(apiEndpoint(config, '/museums')).toBe(
      'https://example.supabase.co/functions/v1/museum-api/museums'
    );
    expect(apiEndpoint(config, '/health')).toBe(
      'https://example.supabase.co/functions/v1/museum-api/health'
    );
  });
});
