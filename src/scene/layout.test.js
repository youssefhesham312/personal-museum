import { describe, it, expect } from 'vitest';
import { computeLayout } from './layout.js';

describe('computeLayout', () => {
  it('should return just a foyer for 0 photos', () => {
    const layout = computeLayout(0);
    expect(layout.rooms).toHaveLength(1);
    expect(layout.rooms[0].type).toBe('foyer');
  });

  it('should create 1 gallery room for a small number of photos', () => {
    const layout = computeLayout(5);
    expect(layout.rooms).toHaveLength(2); // foyer + 1 gallery
    expect(layout.rooms[1].type).toBe('gallery');
    expect(layout.rooms[1].photoSlots).toBe(5);
  });

  it('should create multiple gallery rooms when photos exceed capacity', () => {
    const layout = computeLayout(20);
    expect(layout.rooms.length).toBeGreaterThan(2);
    const totalSlots = layout.rooms
      .filter((r) => r.type === 'gallery')
      .reduce((sum, r) => sum + r.photoSlots, 0);
    expect(totalSlots).toBeGreaterThanOrEqual(20);
  });

  it('should connect rooms with doorways', () => {
    const layout = computeLayout(10);
    for (let i = 0; i < layout.rooms.length - 1; i++) {
      const room = layout.rooms[i];
      expect(room.doorways.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should position rooms so they do not overlap', () => {
    const layout = computeLayout(40);
    for (let i = 0; i < layout.rooms.length; i++) {
      for (let j = i + 1; j < layout.rooms.length; j++) {
        const a = layout.rooms[i];
        const b = layout.rooms[j];
        // Check no center overlap (rooms are on a grid)
        const samePos = a.position.x === b.position.x && a.position.z === b.position.z;
        expect(samePos).toBe(false);
      }
    }
  });
});

describe('computeLayout with a finale room', () => {
  function overlaps(a, b) {
    const aLeft = a.position.x - a.width / 2;
    const aRight = a.position.x + a.width / 2;
    const aTop = a.position.z - a.depth / 2;
    const aBottom = a.position.z + a.depth / 2;

    const bLeft = b.position.x - b.width / 2;
    const bRight = b.position.x + b.width / 2;
    const bTop = b.position.z - b.depth / 2;
    const bBottom = b.position.z + b.depth / 2;

    const overlapX = Math.min(aRight, bRight) - Math.max(aLeft, bLeft);
    const overlapZ = Math.min(aBottom, bBottom) - Math.max(aTop, bTop);
    return overlapX > 0.001 && overlapZ > 0.001;
  }

  it('appends a finale after the galleries', () => {
    const layout = computeLayout(5, { finale: true });
    expect(layout.rooms.map((room) => room.type)).toEqual(['foyer', 'gallery', 'finale']);
  });

  it('keeps the finale after several galleries', () => {
    const layout = computeLayout(15, { finale: true });
    expect(layout.rooms.map((room) => room.type)).toEqual([
      'foyer', 'gallery', 'gallery', 'finale',
    ]);
  });

  it('connects the finale to the last gallery with one doorway', () => {
    const layout = computeLayout(10, { finale: true });
    const finale = layout.rooms[layout.rooms.length - 1];

    expect(finale.type).toBe('finale');
    expect(finale.doorways).toHaveLength(1);
    expect(finale.entryWall).toBeDefined();
    expect(finale.photoSlots).toBe(0);
  });

  it('gives the last gallery an exit doorway', () => {
    const layout = computeLayout(5, { finale: true });
    const gallery = layout.rooms[1];
    expect(gallery.doorways).toHaveLength(2);
  });

  it('does not add a finale to an empty museum', () => {
    const layout = computeLayout(0, { finale: true });
    expect(layout.rooms).toHaveLength(1);
  });

  it('never overlaps any other room', () => {
    for (const count of [5, 10, 15, 40]) {
      const layout = computeLayout(count, { finale: true });
      for (let i = 0; i < layout.rooms.length; i++) {
        for (let j = i + 1; j < layout.rooms.length; j++) {
          expect(overlaps(layout.rooms[i], layout.rooms[j])).toBe(false);
        }
      }
    }
  });
});
