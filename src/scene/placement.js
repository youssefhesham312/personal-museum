/**
 * Frame placement planning.
 *
 * Extracted from the museum builder so the "which wall gets how many photos"
 * rules can be unit tested without a WebGL context.
 *
 * Rules preserved from the original engine:
 *  - walls narrower than 3 units are skipped,
 *  - walls narrower than 8 units get one large "feature" frame,
 *  - wider walls get two standard frames,
 *  - a room never takes more frames than its assigned photo slots.
 */

export const MIN_SEGMENT_WIDTH = 3.0;
export const FEATURE_WALL_MAX_WIDTH = 8.0;

/**
 * @param {Array<{wall: string, segWidth: number}>} wallSegments
 * @param {number} photoSlots
 * @returns {Array<{
 *   wall: string,
 *   segWidth: number,
 *   slotOnWall: number,
 *   slotsOnWall: number,
 *   isFeatureWall: boolean
 * }>}
 */
export function planRoomFrames(wallSegments, photoSlots) {
  const slots = Math.max(0, Math.floor(Number(photoSlots) || 0));
  const plan = [];
  if (slots === 0) return plan;

  const frameable = (Array.isArray(wallSegments) ? wallSegments : [])
    .filter((segment) => segment && segment.segWidth >= MIN_SEGMENT_WIDTH);

  for (const segment of frameable) {
    if (plan.length >= slots) break;

    const isFeatureWall = segment.segWidth < FEATURE_WALL_MAX_WIDTH;
    const slotsOnWall = isFeatureWall ? 1 : 2;

    for (let slotOnWall = 0; slotOnWall < slotsOnWall; slotOnWall++) {
      if (plan.length >= slots) break;
      plan.push({
        wall: segment.wall,
        segWidth: segment.segWidth,
        slotOnWall,
        slotsOnWall,
        isFeatureWall,
        segment,
      });
    }
  }

  return plan;
}

/**
 * Count how many photos a set of wall segments can hold.
 */
export function countFrameCapacity(wallSegments) {
  return planRoomFrames(wallSegments, Number.MAX_SAFE_INTEGER).length;
}
