import * as THREE from 'three';

/**
 * Lighting rig.
 *
 * Three r155+ uses physical light units, so the original `intensity: 2` point
 * lights (authored for legacy lights) barely lit a room. This rig keeps the
 * warm, intimate feel while using a small, fixed number of lights:
 *
 *   - ambient + hemisphere for the base wash,
 *   - one warm point light per room (two in the wider galleries),
 *   - no per-photo spotlights: photographs carry a gentle emissive so they are
 *     always readable without lighting every frame individually.
 *
 * Measured in the preview pane (15 photos, 1600x1310): 16 spotlights cost
 * 17-34 ms/frame versus 3.6-4.5 ms for the same view with two lights.
 */

const AMBIENT_COLOR = 0xfff3e6;
const AMBIENT_INTENSITY = 0.42;
const HEMI_SKY = 0xfff6ea;
const HEMI_GROUND = 0x3a2c20;
const HEMI_INTENSITY = 0.55;

const WARM_LIGHT = 0xffd7a4;

/**
 * Add ambient + hemisphere lighting to the museum.
 */
export function createAmbientLighting(scene) {
  const ambient = new THREE.AmbientLight(AMBIENT_COLOR, AMBIENT_INTENSITY);
  scene.add(ambient);

  const hemisphere = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
  hemisphere.position.set(0, 14, 0);
  scene.add(hemisphere);
}

/**
 * Warm chandelier light for the foyer.
 */
export function createFoyerLight(foyerGroup, height) {
  const light = new THREE.PointLight(WARM_LIGHT, 60, 26, 2);
  light.position.set(0, height - 1.5, 0);
  foyerGroup.add(light);
  return light;
}

/**
 * Ceiling light pools for a gallery room.
 *
 * @param {THREE.Group} group
 * @param {{width: number, depth: number, height: number}} room
 * @returns {THREE.PointLight[]}
 */
export function createRoomLighting(group, { width, depth, height }) {
  const alongX = width >= depth;
  const offset = (alongX ? width : depth) * 0.24;
  const y = height - 0.7;

  const positions = [
    { x: alongX ? -offset : 0, z: alongX ? 0 : -offset },
    { x: alongX ? offset : 0, z: alongX ? 0 : offset },
  ];

  const lights = positions.map((position) => {
    const light = new THREE.PointLight(WARM_LIGHT, 38, 20, 2);
    light.position.set(position.x, y, position.z);
    group.add(light);
    return light;
  });

  return lights;
}

/**
 * A single soft light for the small closing alcove.
 */
export function createFinaleLight(group, height) {
  const light = new THREE.PointLight(WARM_LIGHT, 26, 18, 2);
  light.position.set(0, height - 1.1, 0);
  group.add(light);
  return light;
}
