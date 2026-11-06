import { describe, it, expect } from 'vitest';
import { planRoomFrames, countFrameCapacity, MIN_SEGMENT_WIDTH } from './placement.js';
import { createRoom } from './room.js';
import { computeLayout } from './layout.js';

const segments = (...widths) =>
  widths.map((segWidth, index) => ({ wall: 'north', segWidth, index }));

describe('planRoomFrames', () => {
  it('gives wide walls two frames and narrow walls one feature frame', () => {
    const plan = planRoomFrames(segments(14, 5.6, 3.2), 10);

    expect(plan).toHaveLength(4);
    expect(plan.filter((slot) => slot.wall === 'north' && slot.segWidth === 14)).toHaveLength(2);
    expect(plan.filter((slot) => slot.segWidth === 5.6)).toHaveLength(1);
    expect(plan.filter((slot) => slot.segWidth === 5.6)[0].isFeatureWall).toBe(true);
    expect(plan.filter((slot) => slot.segWidth === 3.2)[0].isFeatureWall).toBe(true);
  });

  it('skips walls narrower than the minimum', () => {
    const plan = planRoomFrames(segments(2.9, 1.2), 8);
    expect(plan).toHaveLength(0);
    expect(MIN_SEGMENT_WIDTH).toBe(3);
  });

  it('never exceeds the requested photo slots', () => {
    const plan = planRoomFrames(segments(14, 14, 14, 14), 3);
    expect(plan).toHaveLength(3);
  });

  it('returns an empty plan for zero slots', () => {
    expect(planRoomFrames(segments(14), 0)).toEqual([]);
  });

  it('exposes the segment object for placement math', () => {
    const input = segments(14);
    const plan = planRoomFrames(input, 2);
    expect(plan[0].segment).toBe(input[0]);
  });

  it('counts capacity per wall configuration', () => {
    expect(countFrameCapacity(segments(14, 5.6, 11))).toBe(5);
  });
});

describe('frame capacity across the generated museum', () => {
  function gallerySegments(room) {
    return createRoom({
      width: room.width,
      depth: room.depth,
      height: room.height,
      doorways: room.doorways,
    }).wallSegments;
  }

  for (const photoCount of [5, 10, 15]) {
    it(`places every photograph for ${photoCount} photos`, () => {
      const layout = computeLayout(photoCount, { finale: true });
      const galleries = layout.rooms.filter((room) => room.type === 'gallery');

      let placed = 0;
      for (const room of galleries) {
        const plan = planRoomFrames(gallerySegments(room), room.photoSlots);
        expect(plan.length).toBeLessThanOrEqual(room.photoSlots);

        // A visitor should never find three photos crammed on one wall.
        const perWall = new Map();
        for (const slot of plan) {
          const key = `${slot.wall}:${slot.segWidth}`;
          perWall.set(key, (perWall.get(key) || 0) + 1);
        }
        for (const count of perWall.values()) {
          expect(count).toBeLessThanOrEqual(2);
        }

        placed += plan.length;
      }

      expect(placed).toBe(photoCount);
    });
  }
});
