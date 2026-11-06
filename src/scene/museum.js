import * as THREE from 'three';
import { computeLayout } from './layout.js';
import { createRoom } from './room.js';
import { createFoyer } from './foyer.js';
import { createFinale } from './finale.js';
import { createFrame } from './frame.js';
import { createAmbientLighting, createRoomLighting } from './lighting.js';
import { planRoomFrames } from './placement.js';
import { normalizeMuseumConfig } from '../core/museumConfig.js';
import { mapWithConcurrency } from '../core/concurrency.js';
import {
  defaultMaxTextureSize,
  loadPhotoTexture,
  releaseTexture,
} from './textures.js';

const TEXTURE_CONCURRENCY = 3;

/**
 * Build the entire museum from a plain configuration object.
 *
 * This function is storage-agnostic: it never reads IndexedDB, never fetches
 * museum metadata and never touches a backend. Everything it needs is in
 * `config`.
 *
 * @param {object} config - see core/museumConfig.js
 * @param {object} [options]
 * @param {number} [options.maxTextureSize] - longest texture edge, in pixels
 * @param {number} [options.anisotropy]
 * @param {number} [options.textureConcurrency]
 * @param {(progress: {loaded: number, total: number}) => void} [options.onProgress]
 * @returns {Promise<{
 *   group: THREE.Group,
 *   collisionMeshes: THREE.Mesh[],
 *   interactables: THREE.Object3D[],
 *   config: object,
 *   dispose: () => void
 * }>}
 */
export async function buildMuseum(config, options = {}) {
  const cfg = normalizeMuseumConfig(config);

  if (cfg.photos.length === 0) {
    throw new Error('This museum has no photographs to display.');
  }

  const maxTextureSize = options.maxTextureSize ?? defaultMaxTextureSize();
  const anisotropy = options.anisotropy ?? 1;
  const concurrency = options.textureConcurrency ?? TEXTURE_CONCURRENCY;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const signal = options.signal ?? null;

  const checkAborted = () => {
    if (signal?.aborted) throw createAbortError();
  };

  checkAborted();

  // ---- 1. Textures (bounded concurrency, downscaled before upload) ----------
  const total = cfg.photos.length;
  let loaded = 0;
  onProgress?.({ loaded: 0, total });

  const textures = await mapWithConcurrency(cfg.photos, concurrency, async (photo, index) => {
    if (signal?.aborted) return null;

    let texture = null;
    try {
      texture = await loadPhotoTexture(photo, { maxSize: maxTextureSize, anisotropy });
    } catch (error) {
      console.warn(`[museum] Photo ${index + 1} could not be loaded`, error);
    }
    loaded += 1;
    onProgress?.({ loaded, total });
    return texture;
  });

  // Cancellation waits for the (at most three) in-flight decodes so nothing is
  // uploaded to the GPU and then orphaned.
  if (signal?.aborted) {
    for (const texture of textures) {
      if (texture) releaseTexture(texture);
    }
    throw createAbortError();
  }

  // Every photo failing means the museum would open as empty frames. Fail with
  // something the loading screen can explain instead (unsupported HEIC files,
  // a codec the browser lost, storage that returned corrupt blobs).
  if (textures.every((texture) => !texture)) {
    throw new Error('None of the photographs could be opened by this browser.');
  }

  // ---- 2. Geometry ---------------------------------------------------------
  const group = new THREE.Group();
  group.name = 'museum';

  const dispose = createDisposer(group);

  try {
    const collisionMeshes = [];
    const interactables = [];

    createAmbientLighting(group);

    const layout = computeLayout(cfg.photos.length, { finale: true });

    const addWalls = (wallSegments) => {
      for (const segment of wallSegments) collisionMeshes.push(segment.mesh);
    };

    // Foyer
    const foyerDesc = layout.rooms.find((room) => room.type === 'foyer');
    if (foyerDesc) {
      const foyer = createFoyer(foyerDesc, cfg);
      group.add(foyer.group);
      addWalls(foyer.wallSegments);
    }

    // Galleries and finale
    let photoCursor = 0;

    for (const roomDesc of layout.rooms) {
      if (roomDesc.type === 'foyer') continue;

      if (roomDesc.type === 'finale') {
        const finale = createFinale(roomDesc, cfg);
        group.add(finale.group);
        addWalls(finale.wallSegments);
        interactables.push(finale.panel);
        continue;
      }

      const { group: roomGroup, wallSegments } = createRoom({
        width: roomDesc.width,
        depth: roomDesc.depth,
        height: roomDesc.height,
        doorways: roomDesc.doorways,
      });

      roomGroup.position.set(roomDesc.position.x, 0, roomDesc.position.z);

      const plan = planRoomFrames(wallSegments, roomDesc.photoSlots);

      for (const slot of plan) {
        const photoIndex = photoCursor;
        const photo = cfg.photos[photoIndex];
        if (!photo) break;
        photoCursor += 1;

        const texture = textures[photoIndex];
        // Size the frame from the decoded image, not from stored metadata, so
        // EXIF rotation or a resized texture can never stretch or crop it.
        const decodedWidth = texture?.image?.width;
        const decodedHeight = texture?.image?.height;

        const frameOptions = {
          texture,
          photoWidth: decodedWidth || photo.width,
          photoHeight: decodedHeight || photo.height,
          photoIndex,
          caption: photo.caption,
          date: photo.date,
        };

        if (slot.isFeatureWall) {
          frameOptions.maxFrameWidth = Math.min(slot.segWidth - 1.5, 7.0);
          frameOptions.maxFrameHeight = Math.min(roomDesc.height - 2.5, 4.0);
        }

        const frame = createFrame(frameOptions);
        const wallMesh = slot.segment.mesh;

        // Position frame on the wall
        const framePos = wallMesh.position.clone();
        if (slot.slotsOnWall === 2) {
          const offsetAmount = slot.segWidth / 4;
          if (slot.wall === 'north' || slot.wall === 'south') {
            framePos.x += slot.slotOnWall === 0 ? -offsetAmount : offsetAmount;
          } else {
            framePos.z += slot.slotOnWall === 0 ? -offsetAmount : offsetAmount;
          }
        }
        framePos.y = roomDesc.height * 0.38;

        frame.position.copy(framePos);
        frame.rotation.copy(wallMesh.rotation);

        // Push frame off the wall surface (half wall thickness + small gap)
        const wallNormal = new THREE.Vector3(0, 0, 1).applyEuler(wallMesh.rotation);
        frame.position.add(wallNormal.multiplyScalar(0.13));

        roomGroup.add(frame);
        interactables.push(frame);
      }

      // Shared warm ceiling pools: two lights per gallery instead of one
      // spotlight per photograph.
      createRoomLighting(roomGroup, roomDesc);

      group.add(roomGroup);
      addWalls(wallSegments);
    }

    return {
      group,
      collisionMeshes,
      interactables,
      config: cfg,
      dispose,
    };
  } catch (error) {
    // Never leave a half-built museum holding GPU memory.
    dispose();
    for (const texture of textures) {
      if (texture) releaseTexture(texture);
    }
    throw error;
  }
}

/**
 * Release every GPU resource owned by a museum group.
 */
function createDisposer(group) {  let disposed = false;

  return function dispose() {
    if (disposed) return;
    disposed = true;

    const materials = new Set();
    const textures = new Set();

    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();

      const material = child.material;
      if (!material) return;

      const list = Array.isArray(material) ? material : [material];
      for (const entry of list) {
        if (entry.map) textures.add(entry.map);
        if (entry.emissiveMap) textures.add(entry.emissiveMap);
        materials.add(entry);
      }
    });

    for (const texture of textures) releaseTexture(texture);
    for (const material of materials) material.dispose();

    group.removeFromParent();
    group.clear();
  };
}

/**
 * Error used when a build is cancelled from the loading screen.
 */
function createAbortError() {
  const error = new Error('Museum build cancelled.');
  error.name = 'AbortError';
  return error;
}
