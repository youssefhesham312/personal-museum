import { describe, it, expect } from 'vitest';
import { normalizeMoveInput, moveDirection, resolvePosition } from './movement.js';

describe('normalizeMoveInput', () => {
  it('keeps inputs inside the unit circle unchanged', () => {
    const value = normalizeMoveInput(0.5, 0.5);
    expect(value.magnitude).toBeCloseTo(Math.hypot(0.5, 0.5), 6);
    expect(value.x).toBeCloseTo(0.5, 6);
  });

  it('normalizes diagonal keyboard input to speed 1', () => {
    const value = normalizeMoveInput(1, 1);
    expect(value.magnitude).toBeCloseTo(1, 6);
    expect(Math.hypot(value.x, value.y)).toBeCloseTo(1, 6);
  });

  it('treats missing values as zero', () => {
    expect(normalizeMoveInput(undefined, null)).toEqual({ x: 0, y: 0, magnitude: 0 });
  });
});

describe('moveDirection', () => {
  it('walks forward along -Z at yaw 0', () => {
    const dir = moveDirection(0, 1, 0);
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(-1, 6);
  });

  it('strafes right along +X at yaw 0', () => {
    const dir = moveDirection(1, 0, 0);
    expect(dir.x).toBeCloseTo(1, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it('turns the forward vector with yaw', () => {
    const dir = moveDirection(0, 1, Math.PI / 2);
    expect(dir.x).toBeCloseTo(-1, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it('returns a zero vector when there is no input', () => {
    expect(moveDirection(0, 0, 1.2)).toEqual({ x: 0, z: 0 });
  });
});

describe('resolvePosition', () => {
  it('moves freely when nothing is in the way', () => {
    const next = resolvePosition({ x: 0, z: 0 }, { x: 1, z: 2 }, () => false);
    expect(next).toEqual({ x: 1, z: 2 });
  });

  it('slides along X when only the Z component is blocked', () => {
    // A wall at z >= 1
    const blocked = (x, z) => z >= 1;
    const next = resolvePosition({ x: 0, z: 0 }, { x: 1, z: 2 }, blocked);
    expect(next).toEqual({ x: 1, z: 0 });
  });

  it('slides along Z when only the X component is blocked', () => {
    const blocked = (x) => x >= 1;
    const next = resolvePosition({ x: 0, z: 0 }, { x: 2, z: 1 }, blocked);
    expect(next).toEqual({ x: 0, z: 1 });
  });

  it('stays put when both axes are blocked', () => {
    const next = resolvePosition({ x: 0, z: 0 }, { x: 1, z: 1 }, () => true);
    expect(next).toEqual({ x: 0, z: 0 });
  });

  it('works without a collision function', () => {
    const next = resolvePosition({ x: 0, z: 0 }, { x: 1, z: 1 });
    expect(next).toEqual({ x: 1, z: 1 });
  });
});
