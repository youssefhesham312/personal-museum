import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SUPABASE_DIR = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');
const FUNCTION_DIR = join(SUPABASE_DIR, 'functions', 'museum-api');
const CLIENT_DIR = fileURLToPath(new URL('../src/', import.meta.url));

function readMigration(name) {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

function migrationNames() {
  return readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
}

const schemaSql = readMigration('20261026090000_phase3_museums.sql');
const cleanupSql = readMigration('20261026090100_phase3_cleanup_schedule.sql');
const r2Sql = readMigration('20261028120000_phase3_r2_photo_storage.sql');
const functionSource = readFileSync(join(FUNCTION_DIR, 'index.ts'), 'utf8');

describe('database schema contract', () => {
  it('ships ordered, committed migrations', () => {
    expect(migrationNames()).toEqual([
      '20261026090000_phase3_museums.sql',
      '20261026090100_phase3_cleanup_schedule.sql',
      '20261028120000_phase3_r2_photo_storage.sql',
    ]);
  });

  it('creates the three private tables and cascades photo deletion', () => {
    expect(schemaSql).toMatch(/create table if not exists public\.museums/);
    expect(schemaSql).toMatch(/create table if not exists public\.museum_photos/);
    expect(schemaSql).toMatch(/create table if not exists public\.creation_events/);
    expect(schemaSql).toMatch(
      /museum_id uuid not null references public\.museums \(id\) on delete cascade/
    );
  });

  it('stores a 22-character public id and an immutable hashed capability', () => {
    expect(schemaSql).toContain("constraint museums_public_id_format check (public_id ~ '^[A-Za-z0-9_-]{22}$')");
    expect(schemaSql).toContain("constraint museums_completion_hash_format check (completion_token_hash ~ '^[0-9a-f]{64}$')");
    expect(schemaSql).toMatch(/new\.public_id := old\.public_id/);
    expect(schemaSql).toMatch(/new\.completion_token_hash := old\.completion_token_hash/);
  });

  it('derives and caps expiry on the server', () => {
    expect(schemaSql).toMatch(/new\.created_at := now\(\)/);
    expect(schemaSql).toMatch(/maximum_expiry := new\.created_at \+ interval '7 days'/);
    expect(schemaSql).toMatch(/new\.expires_at := least\(/);
    expect(schemaSql).toMatch(/new\.expires_at := least\(coalesce\(new\.expires_at, old\.expires_at\), old\.expires_at\)/);
  });

  it('blocks sharing until there are between 5 and 15 photos', () => {
    expect(schemaSql).toMatch(/photo_count < 5 or photo_count > 15/);
    expect(schemaSql).toMatch(/before update of ready_at on public\.museums/);
  });

  it('freezes photos once a museum is shared', () => {
    expect(schemaSql).toMatch(/parent_ready is not null/);
    expect(schemaSql).toMatch(/before insert or update on public\.museum_photos/);
    expect(schemaSql).toMatch(/DELETE is intentionally allowed/);
  });

  it('enables RLS and grants nothing to anon or authenticated', () => {
    expect(schemaSql).toMatch(/alter table public\.museums enable row level security/);
    expect(schemaSql).toMatch(/alter table public\.museum_photos enable row level security/);
    expect(schemaSql).toMatch(/alter table public\.creation_events enable row level security/);

    expect(schemaSql).toMatch(/revoke all on table public\.museums from anon, authenticated/);
    expect(schemaSql).toMatch(/revoke all on table public\.museum_photos from anon, authenticated/);
    expect(schemaSql).toMatch(/revoke all on table public\.creation_events from anon, authenticated/);
    expect(schemaSql).not.toMatch(/grant[\s\S]*?to anon/i);
  });

  it('only creates policies for service_role', () => {
    const policyTargets = [...schemaSql.matchAll(/create policy[\s\S]*?\n\s+to\s+([a-z_]+)/gi)]
      .map((match) => match[1]);
    expect(policyTargets.length).toBeGreaterThanOrEqual(4);
    expect(new Set(policyTargets)).toEqual(new Set(['service_role']));
    expect(schemaSql).not.toMatch(/create policy[\s\S]*?\n\s+to\s+(anon|authenticated|public)/i);
  });

  it('retires the legacy Supabase Storage bucket without deleting data', () => {
    // The original migration provisioned a private bucket for upgrade
    // compatibility; the R2 migration is what production runs now.
    expect(schemaSql).toMatch(/insert into storage\.buckets/);
    expect(schemaSql).toMatch(/'museum-photos'[\s\S]*?false,/);

    expect(r2Sql).toMatch(/drop policy if exists "museum photos service role" on storage\.objects/);
    expect(r2Sql).toMatch(/not exists \(\s*select 1\s*from storage\.objects\s*where bucket_id = 'museum-photos'/);
    expect(r2Sql).toMatch(/delete from storage\.buckets where id = 'museum-photos'/);
    expect(r2Sql).toMatch(/Cloudflare R2 object key/);
    expect(r2Sql).toMatch(/storage_path/);
    // No table or row is dropped by the storage migration.
    expect(r2Sql).not.toMatch(/drop table|truncate|alter table[\s\S]*drop column/i);
  });

  it('restricts the rate-limit function to the service role', () => {
    expect(schemaSql).toMatch(/create or replace function public\.consume_creation_slot/);
    expect(schemaSql).toMatch(/revoke all on function public\.consume_creation_slot\(text, integer\) from anon, authenticated/);
    expect(schemaSql).toMatch(/grant execute on function public\.consume_creation_slot\(text, integer\) to service_role/);
    expect(schemaSql).toMatch(/pg_advisory_xact_lock/);
  });

  it('schedules cleanup without putting a service key in the job', () => {
    expect(cleanupSql).toMatch(/create extension if not exists pg_cron/);
    expect(cleanupSql).toMatch(/create extension if not exists pg_net/);
    expect(cleanupSql).toMatch(/vault\.decrypted_secrets/);
    expect(cleanupSql).toMatch(/net\.http_post/);
    expect(cleanupSql).toMatch(/'x-cleanup-secret', cleanup_secret/);
    expect(cleanupSql).toMatch(/cron\.schedule\(\s*'museum-cleanup'/);
    expect(cleanupSql).toMatch(/'17 \* \* \* \*'/);
    expect(cleanupSql).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(cleanupSql).toMatch(/revoke all on function public\.trigger_museum_cleanup\(\) from anon, authenticated/);
  });
});

describe('museum-api Edge Function contract', () => {
  it('keeps the service role on the server', () => {
    expect(functionSource).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(functionSource).toMatch(/createClient\(SUPABASE_URL, SERVICE_ROLE_KEY/);
    expect(functionSource).not.toMatch(/console\.log\([^)]*SERVICE_ROLE_KEY/);
  });

  it('keeps R2 credentials in Edge Function secrets only', () => {
    expect(functionSource).toMatch(/r2ConfigFromEnv\(Deno\.env\.toObject\(\)\)/);
    expect(functionSource).toMatch(/createR2Client\(R2_CONFIG_RESULT\.config\)/);
    expect(functionSource).not.toMatch(/console\.(log|error)\([^)]*R2_SECRET_ACCESS_KEY/);
    expect(functionSource).not.toMatch(/R2_SECRET_ACCESS_KEY\s*=/);

    const r2Source = readFileSync(join(FUNCTION_DIR, '..', '_shared', 'r2.js'), 'utf8');
    expect(r2Source).toMatch(/R2_ACCOUNT_ID/);
    expect(r2Source).toMatch(/R2_ACCESS_KEY_ID/);
    expect(r2Source).toMatch(/R2_SECRET_ACCESS_KEY/);
    expect(r2Source).toMatch(/R2_BUCKET/);
    expect(r2Source).toMatch(/R2_ENDPOINT/);
  });

  it('resolves every relative import from the deployed function directory', () => {
    const imports = [...functionSource.matchAll(/from\s+['"](\.[^'"]+)['"]/g)]
      .map((match) => match[1]);

    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      expect(specifier, 'shared code must live outside the function bundle root').toMatch(/^\.\.\/_shared\//);
      expect(existsSync(join(FUNCTION_DIR, specifier)), specifier).toBe(true);
    }
  });

  it('creates unpredictable ids and one-time completion tokens', () => {
    expect(functionSource).toMatch(/createPublicId\(\)/);
    expect(functionSource).toMatch(/createCompletionToken\(\)/);
    expect(functionSource).toMatch(/sha256Hex\(completionToken\)/);
    expect(functionSource).toMatch(/crypto\.randomUUID\(\)/);
    expect(functionSource).not.toMatch(/public_id:\s*(body|value)\./);
  });

  it('validates input and rate-limits creation on the server', () => {
    expect(functionSource).toMatch(/validateMuseumInput\(body\)/);
    expect(functionSource).toMatch(/consume_creation_slot/);
    expect(functionSource).toMatch(/rateLimitHash/);
    expect(functionSource).toMatch(/429/);
  });

  it('uses R2 presigned direct uploads and verifies every object before finalizing', () => {
    expect(functionSource).toMatch(/presignPut\(/);
    expect(functionSource).toMatch(/headObject\(/);
    expect(functionSource).toMatch(/object\.size !== Number\(photo\.byte_size\)/);
    expect(functionSource).toMatch(/objectType !== String\(photo\.content_type\)\.toLowerCase\(\)/);
    expect(functionSource).toMatch(/is\('ready_at', null\)/);
    expect(functionSource).toMatch(/museums_assert_ready|ready_at/);
  });

  it('contains no Supabase Storage photo operations', () => {
    expect(functionSource).not.toMatch(/client\.storage/);
    expect(functionSource).not.toMatch(/createSignedUploadUrl|createSignedUrls/);
    expect(functionSource).not.toMatch(/\.from\(BUCKET\)/);
    expect(functionSource).not.toMatch(/MUSEUM_BUCKET/);
  });

  it('only reads finalized, unexpired museums', () => {
    const readBody = functionSource.slice(
      functionSource.indexOf('async function readMuseum'),
      functionSource.indexOf('async function cleanup')
    );

    expect(readBody).toMatch(/!museum \|\| !museum\.ready_at/);
    expect(readBody).toMatch(/isExpired\(museum\.expires_at\)/);
    expect(readBody).toMatch(/presignGet\(/);
    expect(readBody).toMatch(/signedUrlTtl/);
    expect(readBody).toMatch(/Math\.min\(R2_DOWNLOAD_TTL_SECONDS, remainingSeconds\)/);
    expect(readBody).not.toMatch(/completion_token_hash/);
  });

  it('never trusts a client-supplied public id for creation', () => {
    const createBody = functionSource.slice(
      functionSource.indexOf('async function createMuseum'),
      functionSource.indexOf('async function completeMuseum')
    );
    expect(createBody).toMatch(/publicId = createPublicId\(\)/);
    expect(createBody).not.toMatch(/body\.publicId/);
    expect(createBody).not.toMatch(/body\.museumId/);
    expect(createBody).not.toMatch(/body\.expiresAt/);
  });

  it('requires a strong cleanup secret and compares it safely', () => {
    expect(functionSource).toMatch(/CLEANUP_SECRET\.length < 24/);
    expect(functionSource).toMatch(/x-cleanup-secret/);
    expect(functionSource).toMatch(/safeEqual\(provided, CLEANUP_SECRET\)/);
  });

  it('aborts a draft only with its completion token and never after sharing', () => {
    const abortBody = functionSource.slice(
      functionSource.indexOf('async function abortMuseum'),
      functionSource.indexOf('async function readMuseum')
    );
    expect(abortBody).toMatch(/sha256Hex\(token\)/);
    expect(abortBody).toMatch(/safeEqual\(tokenHash, museum\.completion_token_hash\)/);
    expect(abortBody).toMatch(/museum\.ready_at/);
    expect(abortBody).toMatch(/removeMuseumObjects/);
  });

  it('cleans R2 first and keeps rows for retry through the shared orchestrator', () => {
    expect(functionSource).toMatch(/runMuseumCleanup\(store/);
    expect(functionSource).toMatch(/listObjectPaths/);
    expect(functionSource).toMatch(/removeObjects/);
    expect(functionSource).toMatch(/storage\.deleteObject\(path\)/);
    expect(functionSource).toMatch(/deleteMuseum/);
    expect(functionSource).toMatch(/Never delete database rows if photo storage is unavailable/);
  });
});

describe('browser bundle contract', () => {
  const clientFiles = [
    'backend/api.js',
    'backend/config.js',
    'backend/shareFlow.js',
    'backend/upload.js',
    'backend/photoOptimize.js',
  ];

  it('never contains a service-role key reference', () => {
    for (const file of clientFiles) {
      const source = readFileSync(join(CLIENT_DIR, file), 'utf8');
      expect(source, file).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(source, file).not.toMatch(/sb_secret_[A-Za-z0-9]/);
      expect(source, file).not.toMatch(/R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|R2_BUCKET/);
    }
  });

  it('refuses a secret key pasted into the public configuration', () => {
    const source = readFileSync(join(CLIENT_DIR, 'backend/config.js'), 'utf8');
    expect(source).toMatch(/service_role/);
    expect(source).toMatch(/sb_secret_/);
    expect(source).toMatch(/MuseumConfigError/);
  });
});
