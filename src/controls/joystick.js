/**
 * Virtual joystick state machine.
 *
 * Pure math + state so it can be unit tested without a DOM. The UI layer feeds
 * pointer coordinates in and reads a normalized vector out.
 *
 * Screen coordinates grow downwards, so `y` is inverted before it is exposed:
 * pushing up returns +1 (forward).
 */

export const DEFAULT_MAX_RADIUS = 56;

export function createJoystickState({ maxRadius = DEFAULT_MAX_RADIUS } = {}) {
  let active = false;
  let originX = 0;
  let originY = 0;
  let value = { x: 0, y: 0, magnitude: 0 };

  function update(pointerX, pointerY) {
    const dx = pointerX - originX;
    const dy = pointerY - originY;
    const distance = Math.hypot(dx, dy);

    if (distance < 1e-6) {
      value = { x: 0, y: 0, magnitude: 0 };
      return value;
    }

    const clamped = Math.min(distance, maxRadius);
    const scale = distance > maxRadius ? maxRadius / distance : 1;

    value = {
      x: (dx * scale) / maxRadius,
      y: -(dy * scale) / maxRadius,
      magnitude: clamped / maxRadius,
    };
    return value;
  }

  return {
    start(pointerX, pointerY) {
      active = true;
      originX = pointerX;
      originY = pointerY;
      value = { x: 0, y: 0, magnitude: 0 };
      return value;
    },

    move(pointerX, pointerY) {
      if (!active) return value;
      return update(pointerX, pointerY);
    },

    /** Release / pointercancel: always returns to rest. */
    end() {
      active = false;
      value = { x: 0, y: 0, magnitude: 0 };
      return value;
    },

    get active() {
      return active;
    },

    get origin() {
      return { x: originX, y: originY };
    },

    get value() {
      return value;
    },
  };
}
