import * as THREE from 'three';
import { createRoom } from './room.js';
import { createFinaleLight } from './lighting.js';
import { createTextPlane } from './text.js';

const PAPER_COLOR = 0xf8f2e6;
const BACKING_COLOR = 0x2c2118;
const INK = '#332a26';
const INK_ACCENT = '#6d3f4c';
const INK_MUTED = '#8a7c72';
const WALL_GAP = 0.12;

const PANEL_WIDTH = 4.8;
const PANEL_HEIGHT = 3.25;

const BRASS = 0xb08d57;
const WALNUT = 0x3a2a1b;
const LAMPSHADE = 0xf3ddb6;

const OPPOSITE = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/**
 * Reading lectern: wooden base, sloped desk and a small warm lamp.
 *
 * Deliberately modest in size so it does not compete with the letter panel at
 * close range (it used to read as a large black box).
 */
function createLectern() {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({ color: WALNUT, roughness: 0.5 });
  const brassMat = new THREE.MeshStandardMaterial({
    color: BRASS,
    roughness: 0.45,
    metalness: 0.2,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.46), woodMat);
  base.position.y = 0.03;
  base.castShadow = true;
  group.add(base);

  const column = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), woodMat);
  column.position.y = 0.5;
  column.castShadow = true;
  group.add(column);

  const desk = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.05, 0.56), woodMat);
  desk.position.set(0, 0.99, 0);
  desk.rotation.x = -0.3;
  desk.castShadow = true;
  group.add(desk);

  // Paper on the desk.
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.36),
    new THREE.MeshStandardMaterial({ color: PAPER_COLOR, roughness: 0.95 })
  );
  paper.position.set(0, 1.062, 0.005);
  paper.rotation.x = -0.3 - Math.PI / 2;
  group.add(paper);

  // Small lamp: brass stem and a glowing shade.
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), brassMat);
  stem.position.set(0.3, 1.17, -0.12);
  group.add(stem);

  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.115, 0.15, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: LAMPSHADE,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
      toneMapped: false,
    })
  );
  shade.position.set(0.3, 1.37, -0.12);
  group.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe3b5, toneMapped: false })
  );
  bulb.position.set(0.3, 1.32, -0.12);
  group.add(bulb);

  group.userData.desk = desk;
  return group;
}

/**
 * Final-message alcove.
 *
 * A closing room with a lit letter panel on the wall opposite the entrance.
 * The whole panel is one interactable so the visitor can open the message in a
 * readable overlay (see ui/inspectOverlay.js).
 *
 * @param {object} descriptor - from computeLayout (type: 'finale')
 * @param {object} config - normalized museum config
 * @returns {{ group: THREE.Group, wallSegments: Array, panel: THREE.Group }}
 */
export function createFinale(descriptor, config = {}) {
  const { group, wallSegments } = createRoom({
    width: descriptor.width,
    depth: descriptor.depth,
    height: descriptor.height,
    doorways: descriptor.doorways,
  });

  const entryWall = descriptor.entryWall || 'west';
  const farWall = OPPOSITE[entryWall] || 'north';

  const panel = new THREE.Group();
  panel.userData.interact = { type: 'finale' };

  const width = descriptor.width;
  const depth = descriptor.depth;

  // Backing board, brass rim, paper, then three text plates.
  const backing = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH + 0.24, PANEL_HEIGHT + 0.24),
    new THREE.MeshStandardMaterial({ color: BACKING_COLOR, roughness: 0.6 })
  );
  backing.position.z = -0.014;
  panel.add(backing);

  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH + 0.08, PANEL_HEIGHT + 0.08),
    new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.45, metalness: 0.2 })
  );
  rim.position.z = -0.008;
  panel.add(rim);

  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
    new THREE.MeshStandardMaterial({ color: PAPER_COLOR, roughness: 0.95 })
  );
  panel.add(paper);

  const heading = createTextPlane(
    config.recipient ? `For ${config.recipient}` : 'For you',
    {
      fontSize: 62,
      width: 1536,
      height: 256,
      color: INK_ACCENT,
      maxLines: 2,
      planeWidth: 4.1,
      planeHeight: 0.68,
    }
  );
  heading.position.set(0, 1.02, 0.012);
  panel.add(heading);

  const message = config.finalMessage || 'Thank you for walking through these memories.';
  const body = createTextPlane(message, {
    fontSize: 42,
    width: 1536,
    height: 512,
    color: INK,
    lineHeight: 1.42,
    maxLines: 7,
    planeWidth: 4.1,
    planeHeight: 1.37,
  });
  body.position.set(0, -0.02, 0.012);
  panel.add(body);

  const footer = createTextPlane(config.title || '', {
    fontSize: 24,
    width: 1536,
    height: 64,
    color: INK_MUTED,
    maxLines: 1,
    planeWidth: 4.0,
    planeHeight: 0.17,
  });
  footer.position.set(0, -1.27, 0.012);
  panel.add(footer);

  // Mount the panel on the wall opposite the entrance, facing the room.
  const panelY = descriptor.height * 0.43;
  switch (farWall) {
    case 'north':
      panel.position.set(0, panelY, -depth / 2 + WALL_GAP);
      break;
    case 'south':
      panel.position.set(0, panelY, depth / 2 - WALL_GAP);
      panel.rotation.y = Math.PI;
      break;
    case 'east':
      panel.position.set(width / 2 - WALL_GAP, panelY, 0);
      panel.rotation.y = -Math.PI / 2;
      break;
    case 'west':
    default:
      panel.position.set(-width / 2 + WALL_GAP, panelY, 0);
      panel.rotation.y = Math.PI / 2;
      break;
  }
  group.add(panel);

  // Lectern stands a comfortable distance in front of the panel.
  const inward = new THREE.Vector3(0, 0, 1).applyEuler(panel.rotation);
  const lectern = createLectern();
  lectern.position.copy(panel.position).addScaledVector(inward, 1.65);
  lectern.position.y = 0;
  lectern.rotation.y = panel.rotation.y;
  group.add(lectern);

  // One warm light, placed between the panel and the lectern so the letter is
  // evenly lit without a spotlight cone.
  const roomLight = createFinaleLight(group, descriptor.height);
  roomLight.position.copy(panel.position).addScaledVector(inward, 2.1);
  roomLight.position.y = panelY + 0.65;

  group.position.set(descriptor.position.x, 0, descriptor.position.z);

  return { group, wallSegments, panel };
}
