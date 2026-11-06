/**
 * First-person movement math, independent of Three.js and of the DOM so the
 * same logic can serve keyboard, joystick and tests.
 */

/**
 * Clamp a raw move input to a unit-length vector.
 * @param {number} x strafe (+ right)
 * @param {number} y forward (+ forward)
 * @returns {{x: number, y: number, magnitude: number}}
 */
export function normalizeMoveInput(x, y) {
  const rawX = Number.isFinite(x) ? x : 0;
  const rawY = Number.isFinite(y) ? y : 0;
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude <= 1e-6) return { x: 0, y: 0, magnitude: 0 };
  if (magnitude <= 1) return { x: rawX, y: rawY, magnitude };
  return { x: rawX / magnitude, y: rawY / magnitude, magnitude: 1 };
}

/**
 * Convert a relative move input into a world-space direction for a given yaw.
 * Forward is -Z before rotation, matching the camera convention in the museum.
 *
 * @param {number} moveX strafe (+ right)
 * @param {number} moveY forward (+ forward)
 * @param {number} yaw radians
 * @returns {{x: number, z: number}}
 */
export function moveDirection(moveX, moveY, yaw) {
  const input = normalizeMoveInput(moveX, moveY);
  if (input.magnitude === 0) return { x: 0, z: 0 };

  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  // Camera forward is (-sin, -cos) in the XZ plane; right is (cos, -sin).
  const x = input.x * cos - input.y * sin;
  const z = -input.x * sin - input.y * cos;

  return { x, z };
}

/**
 * Move from `current` by `step`, sliding along a single axis when the full
 * step is blocked. Returns the resolved position.
 *
 * @param {{x: number, z: number}} current
 * @param {{x: number, z: number}} step
 * @param {(x: number, z: number) => boolean} isBlocked
 * @returns {{x: number, z: number}}
 */
export function resolvePosition(current, step, isBlocked) {
  const blocked = typeof isBlocked === 'function' ? isBlocked : () => false;
  const targetX = current.x + step.x;
  const targetZ = current.z + step.z;

  if (!blocked(targetX, targetZ)) return { x: targetX, z: targetZ };
  if (!blocked(targetX, current.z)) return { x: targetX, z: current.z };
  if (!blocked(current.x, targetZ)) return { x: current.x, z: targetZ };
  return { x: current.x, z: current.z };
}
