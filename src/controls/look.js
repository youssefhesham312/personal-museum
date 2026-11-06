/**
 * Camera look math. Kept free of Three.js so it can be unit tested and shared
 * by the desktop and touch input paths.
 */

export const PITCH_LIMIT = Math.PI * 0.47; // ~85 degrees

export const MOUSE_SENSITIVITY = 0.002;
export const TOUCH_SENSITIVITY = 0.0045;

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
