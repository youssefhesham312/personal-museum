import * as THREE from 'three';

/**
 * Photo texture loading with a hard pixel budget.
 *
 * Photos living in IndexedDB can be up to 2048 px on the long edge. Uploading
 * fifteen of those to the GPU at once is ~250 MB of VRAM, which drops the
 * context on mid-range phones. Here every photo is decoded at (or resized to)
 * a conservative maximum before it ever reaches Three.js.
 *
 * Photos deliberately set `flipY = false`; the photo plane flips its UVs in
 * frame.js instead. WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap sources,
 * so relying on `flipY` made photos render upside down on some browsers.
 */

export const DESKTOP_TEXTURE_LIMIT = 1280;
export const MOBILE_TEXTURE_LIMIT = 1024;

/**
 * Choose a texture limit for the current device.
 * Coarse pointers (phones/tablets) get the smaller budget.
 */
export function defaultMaxTextureSize(env = {}) {
  const win = env.window ?? (typeof window !== 'undefined' ? window : null);
  if (!win) return DESKTOP_TEXTURE_LIMIT;

  let coarse = false;
  try {
    coarse = Boolean(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
  } catch {
    coarse = false;
  }

  const width = Number(win.innerWidth) || DESKTOP_TEXTURE_LIMIT;
  const height = Number(win.innerHeight) || DESKTOP_TEXTURE_LIMIT;
  const shortEdge = Math.min(width, height);

  if (coarse || shortEdge < 700) return MOBILE_TEXTURE_LIMIT;
  return DESKTOP_TEXTURE_LIMIT;
}

/**
 * Compute the resize target for a photo, preserving aspect ratio.
 * Never upscales.
 */
export function textureTargetSize(width, height, maxSize) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const longest = Math.max(w, h);
  if (!maxSize || longest <= maxSize) return { width: w, height: h, resized: false };

  const scale = maxSize / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
  };
}

/**
 * Decode through an <img> so EXIF orientation is applied consistently by the
 * browser that will also show the photo in the overlay. `createImageBitmap`
 * is faster, but Safari has been inconsistent about EXIF and about observing
 * `resizeWidth`/`resizeHeight`, so the simpler path is the reliable one.
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Photo could not be decoded'));
    image.src = url;
  });
}

/**
 * Load one photo as a GPU-ready texture, resized to the budget.
 *
 * The frame is sized from the returned texture's own dimensions, so metadata
 * that disagrees with the decoded file can never stretch or crop the photo.
 *
 * @param {{url: string, width: number, height: number}} photo
 * @param {{maxSize: number, anisotropy?: number}} options
 * @returns {Promise<THREE.Texture>}
 */
export async function loadPhotoTexture(photo, { maxSize, anisotropy = 1 } = {}) {
  const image = await loadImage(photo.url);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const target = textureTargetSize(sourceWidth, sourceHeight, maxSize);

  let texture;
  if (target.resized && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, target.width, target.height);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.Texture(image);
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  // The photo plane flips V; see the note at the top of this file.
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Release a texture and, when present, the ImageBitmap behind it.
 */
export function releaseTexture(texture) {
  if (!texture || typeof texture !== 'object') return;
  const image = texture.image;
  if (image && typeof image.close === 'function') {
    try {
      image.close();
    } catch {
      /* already closed */
    }
  }
  texture.dispose?.();
}
