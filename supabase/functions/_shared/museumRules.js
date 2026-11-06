/**
 * Rules that decide whether a museum is visible or eligible for cleanup.
 *
 * They are pure and take an explicit "now", so expiry can be tested without
 * waiting seven days or mocking the system clock globally.
 */

export const RETENTION_DAYS = 7;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const DRAFT_GRACE_MS = 60 * 60 * 1000;

export function expiresAtFrom(createdAt) {
  const start = createdAt instanceof Date ? createdAt.getTime() : Date.parse(createdAt);
  if (!Number.isFinite(start)) return null;
  return new Date(start + RETENTION_MS);
}

export function isExpired(expiresAt, now = new Date()) {
  const expiry = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(expiry) || !Number.isFinite(current)) return true;
  return expiry <= current;
}

/**
 * A museum is readable only after it has been finalized and before its
 * server-recorded expiry. Expiry is enforced on every read, even if the
 * cleanup job has not run yet.
 */
export function isPubliclyReadable(museum, now = new Date()) {
  if (!museum || !museum.ready_at) return false;
  return !isExpired(museum.expires_at, now);
}

export function isDraftAbandoned(museum, now = new Date(), graceMs = DRAFT_GRACE_MS) {
  if (!museum || museum.ready_at) return false;
  const created = museum.created_at instanceof Date
    ? museum.created_at.getTime()
    : Date.parse(museum.created_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(current)) return false;
  return current - created >= graceMs;
}

export function sortPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .slice()
    .sort((left, right) => Number(left?.position) - Number(right?.position));
}
