import { createJoystickState } from './joystick.js';
import { TOUCH_SENSITIVITY } from './look.js';

const MOVE_ZONE_MAX_X = 0.5;   // left half of the screen
const MOVE_ZONE_MIN_Y = 0.22;  // ignore the very top of the screen

/**
 * Touch input: floating joystick on the left half, drag-look on the right half,
 * plus a dedicated interact button supplied by the HUD.
 *
 * Uses Pointer Events so a cancelled gesture (incoming call, gesture nav,
 * orientation change) always resets to a safe state.
 *
 * @param {object} options
 * @param {HTMLElement} options.layer - transparent full-screen touch layer
 * @param {import('./player.js').PlayerController} options.player
 * @param {object} options.hud - joystick presentation helpers
 * @param {() => void} [options.onInteract]
 */
export function createTouchInput({ layer, player, hud, onInteract }) {
  const joystick = createJoystickState();
  let enabled = false;

  let movePointerId = null;
  let lookPointerId = null;
  let lastLookX = 0;
  let lastLookY = 0;

  function isMoveZone(clientX, clientY) {
    return (
      clientX < window.innerWidth * MOVE_ZONE_MAX_X &&
      clientY > window.innerHeight * MOVE_ZONE_MIN_Y
    );
  }

  function onPointerDown(event) {
    if (!enabled || event.pointerType === 'mouse') return;

    if (event.target.closest?.('[data-touch-ui]')) return;

    event.preventDefault();

    if (movePointerId === null && isMoveZone(event.clientX, event.clientY)) {
      movePointerId = event.pointerId;
      try {
        layer.setPointerCapture?.(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
      joystick.start(event.clientX, event.clientY);
      hud.showJoystick(event.clientX, event.clientY);
      player.setMove(0, 0);
      return;
    }

    if (lookPointerId === null) {
      lookPointerId = event.pointerId;
      try {
        layer.setPointerCapture?.(event.pointerId);
      } catch {
        /* synthetic pointer */
      }
      lastLookX = event.clientX;
      lastLookY = event.clientY;
    }
  }

  function onPointerMove(event) {
    if (!enabled) return;

    if (event.pointerId === movePointerId) {
      event.preventDefault();
      const value = joystick.move(event.clientX, event.clientY);
      player.setMove(value.x, value.y);
      hud.moveJoystick(value.x * 100, -value.y * 100);
      return;
    }

    if (event.pointerId === lookPointerId) {
      event.preventDefault();
      const dx = event.clientX - lastLookX;
      const dy = event.clientY - lastLookY;
      lastLookX = event.clientX;
      lastLookY = event.clientY;
      player.addLook(dx, dy, TOUCH_SENSITIVITY);
    }
  }

  function releasePointer(event) {
    if (event.pointerId === movePointerId) {
      movePointerId = null;
      joystick.end();
      player.setMove(0, 0);
      hud.hideJoystick();
    }
    if (event.pointerId === lookPointerId) {
      lookPointerId = null;
    }
  }

  function reset() {
    movePointerId = null;
    lookPointerId = null;
    joystick.end();
    player.setMove(0, 0);
    hud.hideJoystick();
  }

  function onContextMenu(event) {
    if (enabled) event.preventDefault();
  }

  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', releasePointer);
  layer.addEventListener('pointercancel', releasePointer);
  layer.addEventListener('pointerleave', releasePointer);
  layer.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', reset);
  window.addEventListener('orientationchange', reset);

  return {
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) reset();
    },
    handleResize: reset,
    dispose() {
      layer.removeEventListener('pointerdown', onPointerDown);
      layer.removeEventListener('pointermove', onPointerMove);
      layer.removeEventListener('pointerup', releasePointer);
      layer.removeEventListener('pointercancel', releasePointer);
      layer.removeEventListener('pointerleave', releasePointer);
      layer.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', reset);
      window.removeEventListener('orientationchange', reset);
    },
  };
}
