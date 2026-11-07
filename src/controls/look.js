/**
 * Camera look math. Kept free of Three.js so it can be unit tested and shared
 * by the desktop and touch input paths.
 */

export const PITCH_LIMIT = Math.PI * 0.47; // ~85 degrees

export const MOUSE_SENSITIVITY = 0.002;
export const TOUCH_SENSITIVITY = 0.0045;

// A tap is a look-zone gesture that neither moved nor lasted long enough to be
// a drag. It is what opens the inspection overlay on touch devices.
export const TAP_MAX_DISTANCE = 10;
export const TAP_MAX_DURATION = 350;

/**
 * @param {{dx?: number, dy?: number, durationMs?: number}} gesture
 * @returns {boolean} true when the gesture should count as a tap
 */
export function isTapGesture({ dx = 0, dy = 0, durationMs = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isFinite(durationMs) || durationMs > TAP_MAX_DURATION) return false;
  return Math.hypot(Number(dx) || 0, Number(dy) || 0) <= TAP_MAX_DISTANCE;
}

export function clampPitch(pitch) {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
}

/**
 * Apply a look delta in pixels.
 * @param {{yaw: number, pitch: number}} look
 * @param {number} dx pixels moved right
 * @param {number} dy pixels moved down
 * @param {number} sensitivity radians per pixel
 * @returns {{yaw: number, pitch: number}}
 */
export function applyLookDelta(look, dx, dy, sensitivity = MOUSE_SENSITIVITY) {
  const yaw = (Number.isFinite(look?.yaw) ? look.yaw : 0) - dx * sensitivity;
  const pitch = clampPitch((Number.isFinite(look?.pitch) ? look.pitch : 0) - dy * sensitivity);
  return { yaw, pitch };
}

/**
 * Wrap yaw into [-PI, PI] so it cannot drift without bound over a long session.
 */
export function normalizeYaw(yaw) {
  if (!Number.isFinite(yaw)) return 0;
  const wrapped = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return wrapped - Math.PI;
}
