import * as THREE from 'three';
import {
  applyLookDelta,
  clampPitch,
  normalizeYaw,
  MOUSE_SENSITIVITY,
} from './look.js';
import { moveDirection, resolvePosition } from './movement.js';

export const MOVE_SPEED = 3.0;
export const PLAYER_HEIGHT = 1.6;

/**
 * First-person camera rig.
 *
 * Owns position, look angles and movement integration. It deliberately knows
 * nothing about pointer lock, keyboards or touch: those are the job of
 * DesktopInput / TouchInput, which push values in here.
 */
export class PlayerController {
  constructor(camera) {
    this.camera = camera;
    this.look = { yaw: 0, pitch: 0 };
    this.moveX = 0;
    this.moveY = 0;
    this.enabled = false;
    this._probe = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  /** Movement and look are ignored while disabled (menus, overlays). */
  setEnabled(value) {
    this.enabled = Boolean(value);
    if (!this.enabled) {
      this.moveX = 0;
      this.moveY = 0;
    }
  }

  /**
   * @param {number} x strafe, -1..1 (+ right)
   * @param {number} y forward, -1..1 (+ forward)
   */
  setMove(x, y) {
    this.moveX = Number.isFinite(x) ? x : 0;
    this.moveY = Number.isFinite(y) ? y : 0;
  }

  /** Apply a pointer delta in pixels. */
  addLook(dx, dy, sensitivity = MOUSE_SENSITIVITY) {
    if (!this.enabled) return;
    this.look = applyLookDelta(this.look, dx, dy, sensitivity);
    this.look.yaw = normalizeYaw(this.look.yaw);
    this._applyLook();
  }

  /** Set absolute look angles (radians). Used by tests and authored spawns. */
  setLook(yaw, pitch = 0) {
    this.look = { yaw: normalizeYaw(yaw), pitch: clampPitch(pitch) };
    this._applyLook();
  }

  _applyLook() {
    this._euler.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this._euler);
  }

  /** Place the visitor at the foyer entrance, looking at the back wall. */
  reset() {
    this.camera.position.set(0, PLAYER_HEIGHT, 0);
    this.look = { yaw: 0, pitch: 0 };
    this._applyLook();
    this.moveX = 0;
    this.moveY = 0;
  }

  /**
   * Integrate one frame of movement with wall sliding.
   * @param {number} delta seconds
   * @param {(position: THREE.Vector3) => boolean} collisionCheck
   */
  update(delta, collisionCheck) {
    if (!this.enabled) return;
    if (this.moveX === 0 && this.moveY === 0) return;

    const direction = moveDirection(this.moveX, this.moveY, this.look.yaw);
    if (direction.x === 0 && direction.z === 0) return;

    const stepLength = MOVE_SPEED * Math.min(Math.max(delta, 0), 0.1);
    const position = this.camera.position;

    const next = resolvePosition(
      { x: position.x, z: position.z },
      { x: direction.x * stepLength, z: direction.z * stepLength },
      (x, z) => Boolean(collisionCheck && collisionCheck(this._probe.set(x, PLAYER_HEIGHT, z)))
    );

    position.x = next.x;
    position.z = next.z;
    position.y = PLAYER_HEIGHT;
  }
}
