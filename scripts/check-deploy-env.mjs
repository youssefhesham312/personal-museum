#!/usr/bin/env node
/**
 * Fail a production deployment early when the public backend configuration is
 * missing or still contains the `.env.example` placeholders.
 *
 * Cloudflare Pages exposes configured environment variables to the build
 * process. Vite also loads `.env`, `.env.local`, `.env.production` and
 * `.env.production.local`, so this checks the same values Vite will inline.
 *
 * Only public values belong here. This script never needs (and deliberately
 * never reads) the Supabase service-role key or any R2 secret.
 */

import { loadEnv } from 'vite';
import { resolveBackendConfig } from '../src/backend/config.js';

const fileEnv = loadEnv('production', process.cwd(), 'VITE_');
const processEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name.startsWith('VITE_'))
);
const env = { ...fileEnv, ...processEnv };

try {
  const config = resolveBackendConfig(env);
  const url = new URL(config.url);

  if (url.protocol !== 'https:') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS for a public deployment.');
  }

  console.log(`Deployment environment OK: ${url.origin}`);
  if (!url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.supabase.in')) {
    console.warn(
      'Note: VITE_SUPABASE_URL is not a *.supabase.co or *.supabase.in host. Confirm this is intentional.'
    );
  }
} catch (error) {
  console.error(`Deployment environment check failed: ${error.message}`);
  console.error(
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the Cloudflare Pages build environment.'
  );
  process.exitCode = 1;
}
