import * as THREE from 'three';

/**
 * Canvas-rendered text plates.
 *
 * The museum uses these for the foyer inscription and the final-message panel.
 * Textures are CanvasTextures, so the normal material-disposal pass releases
 * them along with the room.
 */

const DEFAULT_FONT =
  "'Georgia', 'Times New Roman', 'Segoe UI', Tahoma, 'Noto Naskh Arabic', 'Traditional Arabic', serif";

function splitLines(ctx, text, maxWidth) {
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

function truncate(lines, maxLines) {
  if (!maxLines || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:]+$/, '')}…`;
  return kept;
}

/**
 * Render text into a canvas texture.
 *
 * @param {string} text
 * @param {object} [opts]
 * @returns {THREE.CanvasTexture}
 */
export function createTextTexture(text, opts = {}) {
  const {
    fontSize = 64,
    fontFamily = DEFAULT_FONT,
    fontWeight = '400',
    color = '#2f2723',
    width = 1024,
    height = 256,
    align = 'center',
    lineHeight = 1.32,
    maxLines = 0,
    padding = 32,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const lines = truncate(splitLines(ctx, text, width - padding * 2), maxLines);
  const step = fontSize * lineHeight;
  const totalHeight = (lines.length - 1) * step;
  const startY = height / 2 - totalHeight / 2;
  const x = align === 'left' ? padding : align === 'right' ? width - padding : width / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, startY + i * step);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Create a flat text plate that can be mounted on a wall.
 *
 * @param {string} text
 * @param {object} opts - text options plus planeWidth / planeHeight / color
 * @returns {THREE.Mesh}
 */
export function createTextPlane(text, opts = {}) {
  const { planeWidth = 6, planeHeight = 1.5, opacity = 1 } = opts;
  const texture = createTextTexture(text, opts);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), material);
  mesh.renderOrder = 2;
  mesh.userData.textPlate = true;
  return mesh;
}
