const GALLERY_WIDTH = 14;
const GALLERY_DEPTH = 11;
const GALLERY_HEIGHT = 7;
const FOYER_WIDTH = 18;
const FOYER_DEPTH = 14;
const FOYER_HEIGHT = 9;
const FINALE_WIDTH = 12;
const FINALE_DEPTH = 10;
const FINALE_HEIGHT = 6.5;
const FRAMES_PER_ROOM = 8;
const DOORWAY_WIDTH = 2.8;
const DOORWAY_HEIGHT = 3.8;

/**
 * Return the opposite wall name.
 */
function oppositeWall(wall) {
  switch (wall) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east':  return 'west';
    case 'west':  return 'east';
  }
}

// Direction sequence for zigzag placement.
// Each entry describes how to move from the previous room to the next.
// 'exitWall' is the wall on the previous room where the doorway is placed.
// The entering wall on the new room is the opposite of exitWall.
const DIRECTION_SEQUENCE = [
  { dx: 0, dz: 1, exitWall: 'south' },  // move south
  { dx: 1, dz: 0, exitWall: 'east' },   // move east
  { dx: 0, dz: 1, exitWall: 'south' },  // move south
  { dx: -1, dz: 0, exitWall: 'west' },  // move west
];

/**
 * Place a new room relative to the previous one and wire up the connecting
 * doorway on both sides.
 */
function connectRoom(prevRoom, newRoom, stepIndex) {
  const dir = DIRECTION_SEQUENCE[stepIndex % DIRECTION_SEQUENCE.length];

  let stepX = 0;
  let stepZ = 0;
  if (dir.dx !== 0) stepX = dir.dx * (prevRoom.width / 2 + newRoom.width / 2);
  if (dir.dz !== 0) stepZ = dir.dz * (prevRoom.depth / 2 + newRoom.depth / 2);

  newRoom.position = {
    x: prevRoom.position.x + stepX,
    z: prevRoom.position.z + stepZ,
  };

  const entryWall = oppositeWall(dir.exitWall);
  newRoom.entryWall = entryWall;

  const prevDoorwayPos = (dir.exitWall === 'north' || dir.exitWall === 'south')
    ? prevRoom.width / 2
    : prevRoom.depth / 2;

  const newDoorwayPos = (entryWall === 'north' || entryWall === 'south')
    ? newRoom.width / 2
    : newRoom.depth / 2;

  prevRoom.doorways.push({
    wall: dir.exitWall,
    position: prevDoorwayPos,
    width: DOORWAY_WIDTH,
    height: DOORWAY_HEIGHT,
  });

  newRoom.doorways.push({
    wall: entryWall,
    position: newDoorwayPos,
    width: DOORWAY_WIDTH,
    height: DOORWAY_HEIGHT,
  });

  return newRoom;
}

/**
 * Compute the museum layout given a number of photos.
 * Returns an object with an array of room descriptors, each having
 * position, dimensions, doorways, and frame (photo slot) assignments.
 *
 * Rooms are placed in a zigzag pattern:
 *   foyer -> south -> east -> south -> west -> ...
 *
 * @param {number} photoCount
 * @param {{finale?: boolean}} [options] - when `finale` is true a closing
 *   alcove room is appended after the last gallery.
 */
export function computeLayout(photoCount, options = {}) {
  const rooms = [];
  const count = Math.max(0, Math.floor(Number(photoCount) || 0));
  const withFinale = options.finale === true;

  // Create the foyer
  const foyer = {
    type: 'foyer',
    width: FOYER_WIDTH,
    depth: FOYER_DEPTH,
    height: FOYER_HEIGHT,
    position: { x: 0, z: 0 },
    doorways: [],
    photoSlots: 0,
  };
  rooms.push(foyer);

  if (count === 0) return { rooms };

  // Calculate number of gallery rooms needed
  const galleryCount = Math.ceil(count / FRAMES_PER_ROOM);

  let photosRemaining = count;

  for (let i = 0; i < galleryCount; i++) {
    const prevRoom = rooms[rooms.length - 1];
    const slotsInThisRoom = Math.min(photosRemaining, FRAMES_PER_ROOM);

    const gallery = connectRoom(prevRoom, {
      type: 'gallery',
      width: GALLERY_WIDTH,
      depth: GALLERY_DEPTH,
      height: GALLERY_HEIGHT,
      position: { x: 0, z: 0 },
      doorways: [],
      photoSlots: slotsInThisRoom,
    }, i);

    rooms.push(gallery);
    photosRemaining -= slotsInThisRoom;
  }

  if (withFinale) {
    const prevRoom = rooms[rooms.length - 1];
    const finale = connectRoom(prevRoom, {
      type: 'finale',
      width: FINALE_WIDTH,
      depth: FINALE_DEPTH,
      height: FINALE_HEIGHT,
      position: { x: 0, z: 0 },
      doorways: [],
      photoSlots: 0,
    }, galleryCount);

    rooms.push(finale);
  }

  return { rooms };
}

export {
  FRAMES_PER_ROOM,
  GALLERY_WIDTH,
  GALLERY_DEPTH,
  GALLERY_HEIGHT,
  FOYER_WIDTH,
  FOYER_DEPTH,
  FOYER_HEIGHT,
  FINALE_WIDTH,
  FINALE_DEPTH,
  FINALE_HEIGHT,
  DOORWAY_WIDTH,
  DOORWAY_HEIGHT,
};
