import { describe, it, expect } from 'vitest';
import {
  applyLookDelta,
  clampPitch,
  normalizeYaw,
  isTapGesture,
  PITCH_LIMIT,
  MOUSE_SENSITIVITY,
} from './look.js';

describe('look math', () => {
  it('clamps pitch to the vertical limit', () => {
    expect(clampPitch(10)).toBe(PITCH_LIMIT);
    expect(clampPitch(-10)).toBe(-PITCH_LIMIT);
    expect(clampPitch(0.5)).toBe(0.5);
  });

  it('treats non-finite pitch as zero', () => {
    expect(clampPitch(Number.NaN)).toBe(0);
  });

  it('turns right when the pointer moves right', () => {
    const look = applyLookDelta({ yaw: 0, pitch: 0 }, 100, 0, 0.002);
    expect(look.yaw).toBeCloseTo(-0.2, 6);
    expect(look.pitch).toBe(0);
  });

  it('looks up when the pointer moves up', () => {
    const look = applyLookDelta({ yaw: 0, pitch: 0 }, 0, -100, 0.002);
    expect(look.pitch).toBeCloseTo(0.2, 6);
  });

  it('never exceeds the pitch limit across repeated input', () => {
    let look = { yaw: 0, pitch: 0 };
    for (let i = 0; i < 100; i++) {
      look = applyLookDelta(look, 0, -200, MOUSE_SENSITIVITY);
    }
    expect(look.pitch).toBe(PITCH_LIMIT);
  });

  it('wraps yaw into a bounded range', () => {
    expect(normalizeYaw(Math.PI * 4)).toBeCloseTo(0, 6);
    expect(Math.abs(normalizeYaw(-Math.PI * 3))).toBeCloseTo(Math.PI, 6);
    expect(normalizeYaw(1)).toBeCloseTo(1, 6);
  });

  it('treats a short still gesture as a tap', () => {
    expect(isTapGesture({ dx: 2, dy: -3, durationMs: 120 })).toBe(true);
    expect(isTapGesture({ dx: 0, dy: 0, durationMs: 0 })).toBe(true);
  });

  it('rejects a drag or a long press', () => {
    expect(isTapGesture({ dx: 40, dy: 0, durationMs: 100 })).toBe(false);
    expect(isTapGesture({ dx: 2, dy: 2, durationMs: 600 })).toBe(false);
  });
});
