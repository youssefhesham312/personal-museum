import { describe, it, expect } from 'vitest';
import { createTourState, TOUR_STATES } from './tourState.js';

describe('tour state', () => {
  it('starts idle and blocks movement', () => {
    const tour = createTourState();
    expect(tour.state).toBe(TOUR_STATES.IDLE);
    expect(tour.canMove()).toBe(false);
  });

  it('enters the museum once', () => {
    const tour = createTourState();
    expect(tour.enter()).toBe(true);
    expect(tour.state).toBe(TOUR_STATES.EXPLORING);
    expect(tour.canMove()).toBe(true);
    expect(tour.enter()).toBe(false);
  });

  it('suspends movement while inspecting', () => {
    const tour = createTourState();
    tour.enter();

    const interaction = { type: 'photo', index: 2 };
    expect(tour.inspect(interaction)).toBe(true);
    expect(tour.state).toBe(TOUR_STATES.INSPECTING);
    expect(tour.canMove()).toBe(false);
    expect(tour.activeInteraction).toBe(interaction);
  });

  it('ignores an empty inspection request', () => {
    const tour = createTourState();
    tour.enter();
    expect(tour.inspect(null)).toBe(false);
    expect(tour.canMove()).toBe(true);
  });

  it('does not open two overlays at once', () => {
    const tour = createTourState();
    tour.enter();
    tour.inspect({ type: 'photo', index: 0 });
    expect(tour.inspect({ type: 'finale' })).toBe(false);
    expect(tour.activeInteraction).toEqual({ type: 'photo', index: 0 });
  });

  it('returns to exploring after dismiss', () => {
    const tour = createTourState();
    tour.enter();
    tour.inspect({ type: 'finale' });
    expect(tour.dismiss()).toBe(true);
    expect(tour.state).toBe(TOUR_STATES.EXPLORING);
    expect(tour.activeInteraction).toBeNull();
    expect(tour.canMove()).toBe(true);
  });

  it('cannot dismiss when no overlay is open', () => {
    const tour = createTourState();
    tour.enter();
    expect(tour.dismiss()).toBe(false);
  });

  it('clears everything on leave', () => {
    const tour = createTourState();
    tour.enter();
    tour.inspect({ type: 'photo', index: 1 });
    tour.leave();
    expect(tour.state).toBe(TOUR_STATES.IDLE);
    expect(tour.activeInteraction).toBeNull();
    expect(tour.canMove()).toBe(false);
  });
});
