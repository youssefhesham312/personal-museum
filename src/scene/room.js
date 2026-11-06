import * as THREE from 'three';

const WALL_COLOR = 0xf6ecdd;      // warm parchment
const FLOOR_COLOR = 0x4b3927;     // warm hardwood (fallback without canvas)
const CEILING_COLOR = 0xf6efe3;   // slightly lighter than walls
const BASEBOARD_COLOR = 0x2a2018; // dark strip
const WALL_THICKNESS = 0.2;       // 20cm thick walls

const WOOD_SIZE = 512;
const PLANK_ROWS = 4;

/**
 * Very low-contrast plaster for the walls.
 *
 * Flat colour walls read like cardboard under a warm light rig; a little
 * mottling gives them depth without adding geometry. Returns null in Node so
 * room creation stays DOM-free for unit tests.
 */
function createPlasterTexture() {
  if (typeof document === 'undefined') return null;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#fbf6ec';
  ctx.fillRect(0, 0, size, size);

  // Soft cloudy patches.
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const radius = 10 + Math.random() * 40;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.01 + Math.random() * 0.018;
    gradient.addColorStop(0, `rgba(150, 124, 96, ${alpha})`);
    gradient.addColorStop(1, 'rgba(150, 124, 96, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // Fine grain.
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(120, 98, 76, ${0.008 + Math.random() * 0.014})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1.2, 1.2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural dark hardwood for the floor.
 *
 * Returns null when there is no DOM (unit tests), so `createRoom` can stay a
 * pure geometry function there.
 */
function createWoodTexture(repeatX, repeatY) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = WOOD_SIZE;
  canvas.height = WOOD_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#4a3826';
  ctx.fillRect(0, 0, WOOD_SIZE, WOOD_SIZE);

  // Planks
  const plankHeight = WOOD_SIZE / PLANK_ROWS;
  for (let row = 0; row < PLANK_ROWS; row++) {
    const shade = 58 + Math.round(Math.random() * 14);
    ctx.fillStyle = `rgb(${shade + 26}, ${shade + 8}, ${shade - 10})`;
    ctx.fillRect(0, row * plankHeight, WOOD_SIZE, plankHeight - 1);

    // Grain
    for (let line = 0; line < 26; line++) {
      const y = row * plankHeight + Math.random() * plankHeight;
      const alpha = 0.04 + Math.random() * 0.08;
      ctx.strokeStyle = `rgba(20, 12, 6, ${alpha})`;
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        WOOD_SIZE * 0.33, y + (Math.random() - 0.5) * 6,
        WOOD_SIZE * 0.66, y + (Math.random() - 0.5) * 6,
        WOOD_SIZE, y + (Math.random() - 0.5) * 4
      );
      ctx.stroke();
    }

    // Plank seam
    ctx.fillStyle = 'rgba(12, 8, 4, 0.55)';
    ctx.fillRect(0, row * plankHeight, WOOD_SIZE, 1.5);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create a single room.
 * @param {object} opts
 * @param {number} opts.width   - room width (X axis)
 * @param {number} opts.depth   - room depth (Z axis)
 * @param {number} opts.height  - room height (Y axis)
 * @param {Array}  opts.doorways - array of { wall: 'north'|'south'|'east'|'west', position: number, width: number }
 * @returns {{ group: THREE.Group, wallSegments: Array<{ mesh, wall, segWidth }> }}
 */
export function createRoom({ width, depth, height, doorways = [] }) {
  const group = new THREE.Group();
  const wallSegments = [];

  const plasterTexture = createPlasterTexture();
  const wallMat = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    map: plasterTexture,
    roughness: 0.97,
  });
  const woodTexture = createWoodTexture(width / 3.2, depth / 3.2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: woodTexture ? 0xffffff : FLOOR_COLOR,
    map: woodTexture,
    roughness: 0.58,
    metalness: 0.02,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    color: CEILING_COLOR,
    side: THREE.DoubleSide,
    roughness: 1,
    emissive: 0xf2e2c8,
    emissiveIntensity: 0.32,
  });
  const baseboardMat = new THREE.MeshStandardMaterial({ color: BASEBOARD_COLOR, roughness: 0.7 });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  group.add(ceiling);

  // Build walls with doorway cutouts
  const wallDefs = [
    { name: 'north', axis: 'x', pos: [0, height / 2, -depth / 2], rot: [0, 0, 0], length: width },
    { name: 'south', axis: 'x', pos: [0, height / 2, depth / 2], rot: [0, Math.PI, 0], length: width },
    { name: 'east',  axis: 'z', pos: [width / 2, height / 2, 0], rot: [0, -Math.PI / 2, 0], length: depth },
    { name: 'west',  axis: 'z', pos: [-width / 2, height / 2, 0], rot: [0, Math.PI / 2, 0], length: depth },
  ];

  for (const wallDef of wallDefs) {
    const wallDoorways = doorways.filter((d) => d.wall === wallDef.name);
    const segments = splitWallByDoorways(wallDef.length, height, wallDoorways);

    for (const seg of segments) {
      if (seg.isDoorway) continue;

      const geom = new THREE.BoxGeometry(seg.width, height, WALL_THICKNESS);
      const mesh = new THREE.Mesh(geom, wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Position relative to wall center
      const offset = seg.center - wallDef.length / 2;
      if (wallDef.axis === 'x') {
        mesh.position.set(wallDef.pos[0] + offset, wallDef.pos[1], wallDef.pos[2]);
      } else {
        mesh.position.set(wallDef.pos[0], wallDef.pos[1], wallDef.pos[2] + offset);
      }
      mesh.rotation.set(...wallDef.rot);

      group.add(mesh);
      wallSegments.push({ mesh, wall: wallDef.name, segWidth: seg.width });

      // Baseboard (slightly thicker than wall so it protrudes, raised above floor)
      const bbGeom = new THREE.BoxGeometry(seg.width, 0.10, WALL_THICKNESS + 0.03);
      const bb = new THREE.Mesh(bbGeom, baseboardMat);
      bb.position.copy(mesh.position);
      bb.position.y = 0.06;
      bb.rotation.copy(mesh.rotation);
      group.add(bb);
    }

    // Doorway frame (top piece above opening)
    for (const dw of wallDoorways) {
      const topH = height - dw.height;
      if (topH <= 0) continue;
      const geom = new THREE.BoxGeometry(dw.width, topH, WALL_THICKNESS);
      const mesh = new THREE.Mesh(geom, wallMat);
      const offset = dw.position - wallDef.length / 2;
      if (wallDef.axis === 'x') {
        mesh.position.set(wallDef.pos[0] + offset, dw.height + topH / 2, wallDef.pos[2]);
      } else {
        mesh.position.set(wallDef.pos[0], dw.height + topH / 2, wallDef.pos[2] + offset);
      }
      mesh.rotation.set(...wallDef.rot);
      group.add(mesh);
    }
  }

  return { group, wallSegments };
}

/**
 * Split a wall into solid segments and doorway gaps.
 */
function splitWallByDoorways(wallLength, wallHeight, doorways) {
  if (doorways.length === 0) {
    return [{ width: wallLength, center: wallLength / 2, isDoorway: false }];
  }

  // Sort doorways by position
  const sorted = [...doorways].sort((a, b) => (a.position - a.width / 2) - (b.position - b.width / 2));
  const segments = [];
  let cursor = 0;

  for (const dw of sorted) {
    const dwStart = dw.position - dw.width / 2;
    const dwEnd = dw.position + dw.width / 2;
    dw.height = dw.height || 2.8; // default doorway height

    if (dwStart > cursor) {
      const w = dwStart - cursor;
      segments.push({ width: w, center: cursor + w / 2, isDoorway: false });
    }
    segments.push({ width: dw.width, center: dw.position, isDoorway: true });
    cursor = dwEnd;
  }

  if (cursor < wallLength) {
    const w = wallLength - cursor;
    segments.push({ width: w, center: cursor + w / 2, isDoorway: false });
  }

  return segments;
}
