/**
 * Decide what a click on the museum canvas should do.
 *
 * Pointer lock is captured on the canvas, so after `Esc` releases it the very
 * next click used to be swallowed by a re-capture request even when a frame
 * was squarely in view. A click should always mean "inspect" when there is a
 * target under the reticle; otherwise it should re-capture the mouse so the
 * visitor can look around again.
 *
 * @param {object} state
 * @param {boolean} state.hasTarget - an interactable is under the reticle
 * @param {boolean} state.locked - pointer lock is currently held
 * @param {boolean} state.canLock - the browser supports Pointer Lock
 * @returns {'inspect'|'capture'|'none'}
 */
export function clickAction({ hasTarget = false, locked = false, canLock = true } = {}) {
  if (hasTarget) return 'inspect';
  if (!locked && canLock) return 'capture';
  return 'none';
}
