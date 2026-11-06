import { isPublicId } from '../../supabase/functions/_shared/ids.js';

/** True for /m and /m/... so malformed share links get a friendly page. */
export function isSharePath(pathname) {
  const path = String(pathname || '');
  return path === '/m' || path.startsWith('/m/');
}

/** True only for a well-formed 22-character share id. */
export function isValidShareId(value) {
  return isPublicId(value);
}

/**
 * Extract the public id from /m/<id>. Returns null when the shape is wrong;
 * the caller shows an "invalid link" page rather than opening a museum.
 */
export function parseSharePath(pathname) {
  const path = String(pathname || '').split(/[?#]/, 1)[0];
  const match = /^\/m\/([^/]+)\/?$/.exec(path);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function buildShareUrl(publicId, origin = window.location.origin) {
  if (!isPublicId(publicId)) {
    throw new Error('Cannot build a share URL for an invalid museum id.');
  }

  const base = String(origin).replace(/\/+$/, '');
  return `${base}/m/${publicId}`;
}
