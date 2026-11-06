/**
 * Photo preparation for sharing.
 *
 * The museum itself still renders from whatever URL it is given. This module
 * only produces a browser-friendly copy for direct upload to Cloudflare R2:
 *   - longest edge 1600 px
 *   - WebP at quality 0.82 when supported, JPEG otherwise
 *   - hard client cap of 1.5 MB (the server/R2 verification cap is 2 MB)
 *
 * Decoding through <img> (instead of createImageBitmap) keeps EXIF
 * orientation consistent with the rest of the museum, and drawing to a canvas
 * bakes that orientation into the shared file.
 */

export const MAX_UPLOAD_EDGE = 1600;
export const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5];
const SHRINK_STEPS = 0.86;

export class PhotoOptimisationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhotoOptimisationError';
    this.code = 'photo_optimisation';
  }
}

export function computeUploadDimensions(width, height, maxEdge = MAX_UPLOAD_EDGE) {
  const w = Number(width);
  const h = Number(height);
  const edge = Number(maxEdge);

  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new PhotoOptimisationError('This photograph has invalid dimensions.');
  }

  if (!Number.isFinite(edge) || edge <= 0) {
    throw new PhotoOptimisationError('Invalid upload size configuration.');
  }

  const scale = Math.min(1, edge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new PhotoOptimisationError('This photograph could not be read by this browser.'));
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function isAllowedType(type) {
  return ALLOWED_UPLOAD_TYPES.includes(String(type || '').toLowerCase());
}

/**
 * Optimize one Blob/File for upload. Returns a new Blob plus the dimensions
 * that were actually encoded.
 *
 * @param {Blob} file
 * @param {{maxEdge?: number, maxBytes?: number}} [options]
 * @returns {Promise<{blob: Blob, width: number, height: number, contentType: string}>}
 */
export async function optimizePhotoForUpload(file, options = {}) {
  if (!(file instanceof Blob)) {
    throw new PhotoOptimisationError('This photograph could not be read.');
  }

  const maxEdge = options.maxEdge ?? MAX_UPLOAD_EDGE;
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  const url = URL.createObjectURL(file);

  try {
    const image = await loadImage(url);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const target = computeUploadDimensions(sourceWidth, sourceHeight, maxEdge);

    // Re-encoding a small, already-acceptable file only loses quality.
    if (
      isAllowedType(file.type) &&
      file.size <= maxBytes &&
      sourceWidth <= maxEdge &&
      sourceHeight <= maxEdge
    ) {
      return {
        blob: file,
        width: sourceWidth,
        height: sourceHeight,
        contentType: file.type.toLowerCase(),
      };
    }

    let width = target.width;
    let height = target.height;
    let requestedType = 'image/webp';
    let lastBlob = null;

    for (let attempt = 0; attempt < QUALITY_STEPS.length; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new PhotoOptimisationError('This browser cannot prepare photographs for sharing.');

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, requestedType, QUALITY_STEPS[attempt]);
      if (!blob) throw new PhotoOptimisationError('This photograph could not be prepared for sharing.');

      // Older Safari ignores WebP encoding and returns PNG. Fall back to JPEG,
      // which is supported everywhere and is much smaller for photos.
      if (requestedType === 'image/webp' && blob.type && !blob.type.includes('webp')) {
        requestedType = 'image/jpeg';
      }

      lastBlob = blob;

      if (blob.size <= maxBytes && isAllowedType(blob.type)) {
        return {
          blob,
          width,
          height,
          contentType: blob.type.toLowerCase(),
        };
      }

      // After the first two quality reductions, also shrink the pixels.
      if (attempt >= 2) {
        width = Math.max(1, Math.round(width * SHRINK_STEPS));
        height = Math.max(1, Math.round(height * SHRINK_STEPS));
      }
    }

    if (lastBlob && lastBlob.size > maxBytes) {
      throw new PhotoOptimisationError(
        'This photograph could not be compressed enough to share. Try a smaller image.'
      );
    }

    throw new PhotoOptimisationError('This photograph could not be prepared for sharing.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
