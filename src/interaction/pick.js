import * as THREE from 'three';

/**
 * Interaction targeting.
 *
 * `findInteraction` is pure (walks parent links on plain objects) so it can be
 * tested without a renderer. `pickTarget` is the thin Three.js raycaster.
 */

/**
 * Walk up from a hit object until an ancestor declares `userData.interact`.
 * @param {object|null} object
 * @returns {{type: string, [key: string]: unknown}|null}
 */
export function findInteraction(object) {
  let node = object;
  let guard = 0;

  while (node && guard < 64) {
    const interaction = node.userData && node.userData.interact;
    if (interaction && typeof interaction.type === 'string') return interaction;
    node = node.parent;
    guard += 1;
  }

  return null;
}

const center = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();

/**
 * Cast from the centre of the screen and return the first interactable the
 * visitor is looking at. Walls occlude: the first non-interactable hit stops
 * the search, so you cannot inspect a photo through a wall.
 *
 * @param {THREE.Camera} camera
 * @param {THREE.Object3D[]} interactables
 * @param {THREE.Object3D[]} occluders
 * @param {number} maxDistance
 * @returns {{interaction: object, object: THREE.Object3D, distance: number}|null}
 */
export function pickTarget(camera, interactables, occluders = [], maxDistance = 7) {
  if (!camera || !interactables || interactables.length === 0) return null;

  raycaster.setFromCamera(center, camera);
  raycaster.far = maxDistance;

  const candidates = occluders.length > 0 ? [...interactables, ...occluders] : interactables;
  const hits = raycaster.intersectObjects(candidates, true);

  for (const hit of hits) {
    const interaction = findInteraction(hit.object);
    if (interaction) {
      return { interaction, object: hit.object, distance: hit.distance };
    }
    // Something solid is in the way.
    return null;
  }

  return null;
}
