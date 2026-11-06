import * as THREE from 'three';
import { createRoom } from './room.js';
import { createFoyerLight } from './lighting.js';
import { createTextPlane } from './text.js';
import { FOYER_WIDTH, FOYER_DEPTH, FOYER_HEIGHT } from './layout.js';

const INK = '#332a26';
const INK_MUTED = '#7a6d64';
const WALL_OFFSET = 0.16;
const BACK_WALL_Z = -FOYER_DEPTH / 2 + WALL_OFFSET;

const BRASS = 0xb08d57;
const CANDLE_WAX = 0xf3e6cf;
const FLAME = 0xffc98a;
const RUG = 0x5c3437;
const RUG_TRIM = 0xb08d57;
const BENCH_WOOD = 0x3a2a1b;
const BENCH_CUSHION = 0xc8b29a;

/**
 * A small brass chandelier: ceiling stem, ring, candles and flames.
 * Purely decorative; the actual warm light is added by createFoyerLight.
 */
function createChandelier(height) {
  const group = new THREE.Group();

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xc9a86b,
    roughness: 0.42,
    metalness: 0.22,
  });
  const candleMat = new THREE.MeshStandardMaterial({ color: CANDLE_WAX, roughness: 0.85 });
  const flameMat = new THREE.MeshBasicMaterial({ color: FLAME, toneMapped: false });

  const ringY = height - 1.5;

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10), brassMat);
  stem.position.y = height - 0.75;
  group.add(stem);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 10, 28), brassMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = ringY;
  group.add(ring);

  const candles = 6;
  for (let i = 0; i < candles; i++) {
    const angle = (i / candles) * Math.PI * 2;
    const x = Math.cos(angle) * 0.85;
    const z = Math.sin(angle) * 0.85;

    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8), candleMat);
    candle.position.set(x, ringY + 0.17, z);
    group.add(candle);

    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), flameMat);
    flame.position.set(x, ringY + 0.4, z);
    flame.scale.y = 1.5;
    group.add(flame);
  }

  return group;
}

/**
 * Woven rug with a brass border, laid under the bench.
 */
function createRug() {
  const group = new THREE.Group();

  const trim = new THREE.Mesh(
    new THREE.PlaneGeometry(6.2, 4.6),
    new THREE.MeshStandardMaterial({ color: RUG_TRIM, roughness: 0.95 })
  );
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = 0.012;
  group.add(trim);

  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(5.85, 4.25),
    new THREE.MeshStandardMaterial({ color: RUG, roughness: 1 })
  );
  field.rotation.x = -Math.PI / 2;
  field.position.y = 0.014;
  group.add(field);

  group.position.set(0, 0, 0.4);
  return group;
}

/**
 * Bench: wooden frame, four turned legs and a soft cushion.
 */
function createBench() {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({ color: BENCH_WOOD, roughness: 0.5 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: BENCH_CUSHION, roughness: 0.95 });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 0.9), woodMat);
  seat.position.y = 0.44;
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);

  const cushion = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 0.82), cushionMat);
  cushion.position.y = 0.55;
  cushion.castShadow = true;
  group.add(cushion);

  const legGeometry = new THREE.CylinderGeometry(0.05, 0.04, 0.44, 8);
  for (const x of [-1.12, 1.12]) {
    for (const z of [-0.34, 0.34]) {
      const leg = new THREE.Mesh(legGeometry, woodMat);
      leg.position.set(x, 0.22, z);
      leg.castShadow = true;
      group.add(leg);
    }
  }

  return group;
}

/**
 * Build the foyer scene.
 *
 * @param {object} descriptor - from computeLayout
 * @param {object} config - normalized museum config (title, recipient, dedication)
 * @returns {{ group: THREE.Group, wallSegments: Array }}
 */
export function createFoyer(descriptor, config = {}) {
  const { group, wallSegments } = createRoom({
    width: FOYER_WIDTH,
    depth: FOYER_DEPTH,
    height: FOYER_HEIGHT,
    doorways: descriptor.doorways,
  });

  const title = config.title || 'Personal Museum';
  const recipient = config.recipient || '';
  const dedication = config.dedication || '';
  const photoCount = Array.isArray(config.photos) ? config.photos.length : 0;

  // Title inscription on the back wall
  const titlePlate = createTextPlane(title, {
    fontSize: 96,
    width: 2048,
    height: 256,
    color: INK,
    lineHeight: 1.15,
    maxLines: 2,
    planeWidth: 9.5,
    planeHeight: 1.19,
  });
  titlePlate.position.set(0, 5.35, BACK_WALL_Z);
  group.add(titlePlate);

  if (recipient) {
    const recipientPlate = createTextPlane(`for ${recipient}`, {
      fontSize: 52,
      width: 1024,
      height: 128,
      color: INK_MUTED,
      maxLines: 1,
      planeWidth: 6.5,
      planeHeight: 0.8125,
    });
    recipientPlate.position.set(0, 4.35, BACK_WALL_Z);
    group.add(recipientPlate);
  }

  if (dedication) {
    const dedicationPlate = createTextPlane(dedication, {
      fontSize: 40,
      width: 1024,
      height: 384,
      color: INK,
      lineHeight: 1.45,
      maxLines: 4,
      planeWidth: 6.5,
      planeHeight: 2.44,
    });
    dedicationPlate.position.set(0, 2.75, BACK_WALL_Z);
    group.add(dedicationPlate);
  }

  if (photoCount > 0) {
    const countLabel = photoCount === 1 ? 'one photograph' : `${photoCount} photographs`;
    const countPlate = createTextPlane(countLabel, {
      fontSize: 34,
      width: 1024,
      height: 80,
      color: INK_MUTED,
      maxLines: 1,
      planeWidth: 4.8,
      planeHeight: 0.375,
    });
    countPlate.position.set(0, 1.22, BACK_WALL_Z);    group.add(countPlate);
  }

  group.add(createChandelier(FOYER_HEIGHT));
  group.add(createRug());
  group.add(createBench());

  // Foyer chandelier light
  createFoyerLight(group, FOYER_HEIGHT);

  group.position.set(descriptor.position.x, 0, descriptor.position.z);

  return { group, wallSegments };
}
