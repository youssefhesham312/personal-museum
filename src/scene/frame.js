import * as THREE from 'three';

const FRAME_DEPTH = 0.09;
const MAT_WIDTH = 0.07;    // warm mat border
const FRAME_BORDER = 0.085; // walnut molding width
const LINER_WIDTH = 0.022;  // thin brass liner between mat and wood

const FRAME_COLOR = 0x3a2a1b;   // warm walnut
const LINER_COLOR = 0xb08d57;   // muted brass
const MAT_COLOR = 0xf3ece0;     // warm off-white mat
const EMPTY_PHOTO_COLOR = 0x2a211a;

const CAPTION_CANVAS_WIDTH = 768;
const CAPTION_CANVAS_HEIGHT = 144;
const CAPTION_INK = '#3c312a';
const CAPTION_MUTED = '#8d7c6c';
const CAPTION_PAPER = '#f8f1e4';

/**
 * Flip a plane's V coordinates. Photo textures are uploaded without WebGL's
 * vertical flip (that flag is ignored for ImageBitmap uploads), so the plane
 * provides the flip instead. Exported for tests.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.BufferGeometry}
 */
export function flipVerticalUvs(geometry) {
  const uv = geometry?.getAttribute?.('uv');
  if (!uv) return geometry;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setY(index, 1 - uv.getY(index));
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Turn "March 2021" into a compact card line, keeping the caption on top and
 * the date underneath. Rendered once into a canvas so it is one draw call.
 */
function createCaptionPlane({ caption, date, planeWidth }) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = CAPTION_CANVAS_WIDTH;
  canvas.height = CAPTION_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Rounded paper card.
  const radius = 16;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(CAPTION_CANVAS_WIDTH - radius, 0);
  ctx.quadraticCurveTo(CAPTION_CANVAS_WIDTH, 0, CAPTION_CANVAS_WIDTH, radius);
  ctx.lineTo(CAPTION_CANVAS_WIDTH, CAPTION_CANVAS_HEIGHT - radius);
  ctx.quadraticCurveTo(CAPTION_CANVAS_WIDTH, CAPTION_CANVAS_HEIGHT, CAPTION_CANVAS_WIDTH - radius, CAPTION_CANVAS_HEIGHT);
  ctx.lineTo(radius, CAPTION_CANVAS_HEIGHT);
  ctx.quadraticCurveTo(0, CAPTION_CANVAS_HEIGHT, 0, CAPTION_CANVAS_HEIGHT - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();

  ctx.fillStyle = CAPTION_PAPER;
  ctx.fill();
  ctx.strokeStyle = 'rgba(176, 141, 87, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const text = String(caption ?? '').trim();
  const when = String(date ?? '').trim();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (text) {
    let size = 46;
    ctx.font = `400 ${size}px Georgia, "Times New Roman", serif`;
    while (size > 26 && ctx.measureText(text).width > CAPTION_CANVAS_WIDTH - 64) {
      size -= 2;
      ctx.font = `400 ${size}px Georgia, "Times New Roman", serif`;
    }
    ctx.fillStyle = CAPTION_INK;
    ctx.fillText(text, CAPTION_CANVAS_WIDTH / 2, when ? 52 : CAPTION_CANVAS_HEIGHT / 2);
  }

  if (when) {
    ctx.font = 'italic 400 30px Georgia, "Times New Roman", serif';
    ctx.fillStyle = CAPTION_MUTED;
    ctx.fillText(when, CAPTION_CANVAS_WIDTH / 2, 104);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
  });

  const planeHeight = planeWidth * (CAPTION_CANVAS_HEIGHT / CAPTION_CANVAS_WIDTH);
  return new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), material);
}

/**
 * Create a photo frame mesh.
 *
 * The texture is supplied by the caller (see scene/textures.js) so the frame
 * never touches storage and stays cheap to rebuild.
 *
 * Photos carry a low emissive copy of their own texture: with the shared
 * room-light rig (no per-photo spotlights) that keeps them readable without
 * washing out the warm room.
 *
 * @param {object} opts
 * @param {THREE.Texture|null} opts.texture
 * @param {number} opts.photoWidth - original photo width in pixels
 * @param {number} opts.photoHeight - original photo height in pixels
 * @param {number} [opts.maxFrameWidth] - max width for the frame in world units
 * @param {number} [opts.maxFrameHeight] - max height for the frame in world units
 * @param {number} [opts.photoIndex] - index in the museum config, used for interaction
 * @param {string} [opts.caption]
 * @param {string} [opts.date]
 * @returns {THREE.Group}
 */
export function createFrame({
  texture = null,
  photoWidth = 1600,
  photoHeight = 1200,
  maxFrameWidth = 4.0,
  maxFrameHeight = 3.0,
  photoIndex = null,
  caption = '',
  date = '',
}) {
  const group = new THREE.Group();

  // Calculate photo dimensions to fit within max bounds, preserving aspect ratio
  const safeWidth = Math.max(1, Number(photoWidth) || 1);
  const safeHeight = Math.max(1, Number(photoHeight) || 1);
  const aspect = safeWidth / safeHeight;
  let w, h;
  if (aspect > maxFrameWidth / maxFrameHeight) {
    w = maxFrameWidth;
    h = maxFrameWidth / aspect;
  } else {
    h = maxFrameHeight;
    w = maxFrameHeight * aspect;
  }

  // Photo plane (lit + gently self-illuminated)
  const photoMat = new THREE.MeshStandardMaterial({
    map: texture,
    color: texture ? 0xffffff : EMPTY_PHOTO_COLOR,
    roughness: 0.86,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: texture,
    emissiveIntensity: texture ? 0.26 : 0,
  });
  const photoGeometry = new THREE.PlaneGeometry(w, h);
  // Photo textures are uploaded with flipY=false (WebGL ignores that flag for
  // ImageBitmap sources), so flip the plane's V coordinates instead. This is
  // browser-independent and keeps map/emissiveMap aligned.
  flipVerticalUvs(photoGeometry);
  const photoMesh = new THREE.Mesh(photoGeometry, photoMat);
  photoMesh.name = 'frame-photo';
  photoMesh.position.z = FRAME_DEPTH / 2 + 0.002;
  group.add(photoMesh);

  // Brass liner just behind the mat, so a thin warm rim shows around it.
  const matW = w + MAT_WIDTH * 2;
  const matH = h + MAT_WIDTH * 2;
  const linerMat = new THREE.MeshStandardMaterial({
    color: LINER_COLOR,
    roughness: 0.45,
    metalness: 0.2,
  });
  const linerMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(matW + LINER_WIDTH * 2, matH + LINER_WIDTH * 2),
    linerMat
  );
  linerMesh.position.z = FRAME_DEPTH / 2 - 0.004;
  group.add(linerMesh);

  // Warm mat (slightly larger than photo)
  const matMat = new THREE.MeshStandardMaterial({ color: MAT_COLOR, roughness: 0.98 });
  const matMesh = new THREE.Mesh(new THREE.PlaneGeometry(matW, matH), matMat);
  matMesh.position.z = FRAME_DEPTH / 2;
  group.add(matMesh);

  // Frame border (box around the mat)
  const frameW = matW + LINER_WIDTH * 2 + FRAME_BORDER * 2;
  const frameH = matH + LINER_WIDTH * 2 + FRAME_BORDER * 2;
  const frameMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR,
    roughness: 0.52,
    metalness: 0.08,
  });

  const outerW = matW + LINER_WIDTH * 2;
  const outerH = matH + LINER_WIDTH * 2;

  // Top
  const top = new THREE.Mesh(new THREE.BoxGeometry(frameW, FRAME_BORDER, FRAME_DEPTH), frameMat);
  top.position.set(0, outerH / 2 + FRAME_BORDER / 2, 0);
  top.castShadow = true;
  group.add(top);

  // Bottom
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(frameW, FRAME_BORDER, FRAME_DEPTH), frameMat);
  bottom.position.set(0, -(outerH / 2 + FRAME_BORDER / 2), 0);
  bottom.castShadow = true;
  group.add(bottom);

  // Left
  const left = new THREE.Mesh(new THREE.BoxGeometry(FRAME_BORDER, outerH, FRAME_DEPTH), frameMat);
  left.position.set(-(outerW / 2 + FRAME_BORDER / 2), 0, 0);
  left.castShadow = true;
  group.add(left);

  // Right
  const right = new THREE.Mesh(new THREE.BoxGeometry(FRAME_BORDER, outerH, FRAME_DEPTH), frameMat);
  right.position.set(outerW / 2 + FRAME_BORDER / 2, 0, 0);
  right.castShadow = true;
  group.add(right);

  // Back panel
  const backMat = new THREE.MeshStandardMaterial({ color: 0x241c15, roughness: 0.9 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(frameW, frameH), backMat);
  back.position.z = -FRAME_DEPTH / 2;
  back.rotation.y = Math.PI;
  group.add(back);

  // Caption card, tucked under the frame.
  if (caption || date) {
    const cardWidth = Math.min(Math.max(frameW * 0.62, 0.9), 2.2);
    const card = createCaptionPlane({ caption, date, planeWidth: cardWidth });
    if (card) {
      const cardHeight = cardWidth * (CAPTION_CANVAS_HEIGHT / CAPTION_CANVAS_WIDTH);
      card.position.set(0, -(frameH / 2 + cardHeight / 2 + 0.09), FRAME_DEPTH / 2 - 0.012);
      group.add(card);
    }
  }

  // Store total frame dimensions for placement calculations
  group.userData.frameWidth = frameW;
  group.userData.frameHeight = frameH;

  if (Number.isInteger(photoIndex)) {
    group.userData.interact = { type: 'photo', index: photoIndex };
  }

  return group;
}
