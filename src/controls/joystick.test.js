import { describe, it, expect } from 'vitest';
import { createJoystickState, DEFAULT_MAX_RADIUS } from './joystick.js';

describe('joystick', () => {
  it('is inert before the gesture starts', () => {
    const stick = createJoystickState();
    expect(stick.move(0, 0)).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(stick.active).toBe(false);
  });

  it('points up when the thumb moves up (forward)', () => {
    const stick = createJoystickState({ maxRadius: 50 });
    stick.start(100, 100);
    const value = stick.move(100, 50);

    expect(value.x).toBeCloseTo(0, 6);
    expect(value.y).toBeCloseTo(1, 6);
    expect(value.magnitude).toBeCloseTo(1, 6);
  });

  it('points right for a rightward drag', () => {
    const stick = createJoystickState({ maxRadius: 50 });
    stick.start(100, 100);
    const value = stick.move(125, 100);

    expect(value.x).toBeCloseTo(0.5, 6);
    expect(value.y).toBeCloseTo(0, 6);
  });

  it('clamps the magnitude at the radius', () => {
    const stick = createJoystickState({ maxRadius: 50 });
    stick.start(0, 0);
    const value = stick.move(500, 0);

    expect(value.magnitude).toBeCloseTo(1, 6);
    expect(Math.hypot(value.x, value.y)).toBeCloseTo(1, 6);
  });

  it('accepts a fractional magnitude for slow walking', () => {
    const stick = createJoystickState({ maxRadius: 100 });
    stick.start(0, 0);
    const value = stick.move(25, 0);

    expect(value.magnitude).toBeCloseTo(0.25, 6);
  });

  it('resets to rest on release and on cancel', () => {
    const stick = createJoystickState({ maxRadius: DEFAULT_MAX_RADIUS });
    stick.start(10, 10);
    stick.move(60, 10);
    expect(stick.value.magnitude).toBeGreaterThan(0);

    expect(stick.end()).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(stick.active).toBe(false);
    expect(stick.move(80, 80)).toEqual({ x: 0, y: 0, magnitude: 0 });
  });

  it('restarts from the new touch point', () => {
    const stick = createJoystickState({ maxRadius: 50 });
    stick.start(0, 0);
    stick.move(50, 0);
    stick.end();
    stick.start(300, 300);
    expect(stick.move(300, 300)).toEqual({ x: 0, y: 0, magnitude: 0 });
    expect(stick.origin).toEqual({ x: 300, y: 300 });
  });
});
