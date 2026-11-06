/**
 * Cleanup orchestration, independent of Supabase.
 *
 * The adapter passed in by the Edge Function must provide:
 *   listExpired(nowIso, limit)      -> museums with expires_at <= now
 *   listAbandoned(cutoffIso, limit) -> unfinished museums older than cutoff
 *   listObjectPaths(museumId)       -> every R2 object key under that museum
 *   removeObjects(paths)            -> deletes them (throws on failure)
 *   deleteMuseum(museumId)          -> deletes the row (cascades photo rows)
 *
 * Order matters: R2 objects are removed first, then the database row. If R2
 * deletion fails (including a partial delete), the row is kept so the next run
 * lists and retries whatever remains. If the row deletion fails after the
 * objects are gone, the next run sees no objects and simply deletes the row.
 * Both paths are therefore idempotent and retryable.
 */

function safeError(error) {
  const raw = typeof error?.message === 'string' ? error.message : 'Unknown cleanup error';
  return raw.replace(/https?:\/\/\S+/g, '[url]').slice(0, 240);
}

export async function runMuseumCleanup(store, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const batchSize = Math.max(1, Math.min(100, Number(options.batchSize) || 25));
  const graceMs = Number(options.graceMs) > 0 ? Number(options.graceMs) : 60 * 60 * 1000;

  const nowIso = now.toISOString();
  const cutoffIso = new Date(now.getTime() - graceMs).toISOString();

  const summary = {
    scanned: 0,
    deleted: 0,
    failed: 0,
    objectsRemoved: 0,
    errors: [],
  };

  const candidates = [];
  const seen = new Set();

  const addCandidates = (rows) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      candidates.push(row);
    }
  };

  try {
    addCandidates(await store.listExpired(nowIso, batchSize));
  } catch (error) {
    summary.failed += 1;
    summary.errors.push({ museumId: null, stage: 'list_expired', message: safeError(error) });
  }

  try {
    addCandidates(await store.listAbandoned(cutoffIso, batchSize));
  } catch (error) {
    summary.failed += 1;
    summary.errors.push({ museumId: null, stage: 'list_abandoned', message: safeError(error) });
  }

  summary.scanned = candidates.length;

  for (const museum of candidates) {
    try {
      const paths = await store.listObjectPaths(museum.id);
      if (paths.length > 0) {
        await store.removeObjects(paths);
        summary.objectsRemoved += paths.length;
      }
      await store.deleteMuseum(museum.id);
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        museumId: museum.id,
        stage: 'delete',
        message: safeError(error),
      });
    }
  }

  return summary;
}
