import { MOUSE_SENSITIVITY } from './look.js';
import { clickAction } from '../core/clickAction.js';

const MOVEMENT_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/**
 * Desktop input: keyboard movement, pointer-lock mouse look, drag-look
 * fallback, and click / E to inspect.
 *
 * Movement is intentionally NOT gated on pointer lock. If the browser refuses
 * or does not support the Pointer Lock API the museum stays usable, and the
 * visitor can always leave with the on-screen exit button.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {import('./player.js').PlayerController} options.player
 * @param {() => void} [options.onInteract]
 * @param {() => boolean} [options.hasTarget] - is something under the reticle?
 * @param {(locked: boolean) => void} [options.onLockChange]
 */
export function createDesktopInput({ canvas, player, onInteract, hasTarget, onLockChange }) {
  const pressed = new Set();
  let enabled = false;
  let locked = false;
  let dragging = false;
  let dragTravel = 0;
  let lastX = 0;
  let lastY = 0;
  let suppressClick = false;

  function canLock() {
    return typeof canvas.requestPointerLock === 'function';
  }

  function updateMove() {
    if (!enabled) {
      player.setMove(0, 0);
      return;
    }

    const forward =
      (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) -
      (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0);
    const right =
      (pressed.has('KeyD') || pressed.has('ArrowRight') ? 1 : 0) -
      (pressed.has('KeyA') || pressed.has('ArrowLeft') ? 1 : 0);

    player.setMove(right, forward);
  }

  function onKeyDown(event) {
    if (!enabled) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === 'KeyE') {
      event.preventDefault();
      onInteract?.();
      return;
    }

    if (MOVEMENT_CODES.has(event.code)) {
      event.preventDefault();
      pressed.add(event.code);
      updateMove();
    }
  }

  function onKeyUp(event) {
    if (!MOVEMENT_CODES.has(event.code)) return;
    pressed.delete(event.code);
    updateMove();
  }

  function onMouseMove(event) {
    if (!enabled) return;

    if (locked) {
      player.addLook(event.movementX || 0, event.movementY || 0, MOUSE_SENSITIVITY);
      return;
    }

    if (!dragging) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    dragTravel += Math.abs(dx) + Math.abs(dy);
    if (dragTravel > 4) suppressClick = true;
    player.addLook(dx, dy, MOUSE_SENSITIVITY * 1.4);
  }

  function onPointerDown(event) {
    if (!enabled || locked || event.button !== 0) return;
    dragging = true;
    dragTravel = 0;
    lastX = event.clientX;
    lastY = event.clientY;
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
  }

  function endDrag() {
    dragging = false;
  }

  function onClick() {
    if (!enabled) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const action = clickAction({
      hasTarget: Boolean(hasTarget?.()),
      locked,
      canLock: canLock(),
    });

    if (action === 'inspect') {
      onInteract?.();
      return;
    }
    if (action === 'capture') requestLock();
  }

  function onLockStateChange() {
    locked = document.pointerLockElement === canvas;
    onLockChange?.(locked);
  }

  function onLockError() {
    locked = false;
    onLockChange?.(false);
  }

  function requestLock() {
    if (!canLock() || document.pointerLockElement === canvas) return;
    try {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* Pointer lock is a progressive enhancement. */
    }
  }

  function releaseLock() {
    if (document.pointerLockElement === canvas) {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  function onBlur() {
    pressed.clear();
    endDrag();
    player.setMove(0, 0);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockStateChange);
  document.addEventListener('pointerlockerror', onLockError);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('click', onClick);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  return {
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        pressed.clear();
        endDrag();
        player.setMove(0, 0);
      }
    },
    requestLock,
    releaseLock,
    isLocked() {
      return locked;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockStateChange);
      document.removeEventListener('pointerlockerror', onLockError);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    },
  };
}
