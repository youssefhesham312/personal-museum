import { savePhoto, getPhotoCount } from '../storage/db.js';
import { MUSEUM_LIMITS } from '../../supabase/functions/_shared/validation.js';

const MAX_TEXTURE_SIZE = 2048;
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

/**
 * Keep only the files that fit in the museum. The rest are reported instead of
 * silently dropped. Pure so the limit can be tested without a browser.
 */
export function partitionByPhotoLimit(fileList, existingCount = 0, maxPhotos = MUSEUM_LIMITS.maxPhotos) {
  const files = Array.from(fileList || []);
  const existing = Math.max(0, Number(existingCount) || 0);
  const remaining = Math.max(0, maxPhotos - existing);
  return {
    accepted: files.slice(0, remaining),
    skipped: files.slice(remaining),
    remaining,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be decoded'));
    image.src = url;
  });
}

/**
 * True when the file looks like an Apple HEIC/HEIF photo. Those decode in
 * Safari but not in Chromium, so the message should name the format instead of
 * saying "could not be decoded".
 */
export function looksLikeHeic(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type.includes('heic') || type.includes('heif')) return true;
  return /\.(heic|heif)$/i.test(String(file?.name || ''));
}

/**
 * Turn a per-file failure into a short, person-readable explanation.
 */
export function uploadFailureReason(file, error) {
  if (error?.name === 'QuotaExceededError') {
    return 'browser storage is full';
  }
  if (error?.name === 'InvalidStateError' || error?.name === 'UnknownError') {
    return 'browser storage is unavailable';
  }
  if (looksLikeHeic(file)) {
    return 'HEIC photos are not supported by this browser';
  }
  return 'the file could not be read as an image';
}

/**
 * Build the message shown under the upload button. Pure so it can be tested
 * without a DOM.
 *
 * @param {{added: number, failed: Array<{name: string, reason: string}>}} result
 * @returns {{text: string, tone: 'ok'|'warn'|'error'}}
 */
export function buildUploadSummary(result) {
  const added = Number(result?.added) || 0;
  const failed = Array.isArray(result?.failed) ? result.failed : [];
  const limitSkipped = Math.max(0, Number(result?.limitSkipped) || 0);
  const heic = failed.some((entry) => looksLikeHeic(entry?.file ?? entry));
  const limitText = limitSkipped > 0
    ? ` Only ${MUSEUM_LIMITS.maxPhotos} photos fit in a museum; ${limitSkipped} ${limitSkipped === 1 ? 'was' : 'were'} not added.`
    : '';

  if (failed.length === 0) {
    return {
      text: (added === 1 ? '1 photo added.' : `${added} photos added.`) + limitText,
      tone: limitSkipped > 0 ? 'warn' : 'ok',
    };
  }

  const names = failed.slice(0, 2).map((file) => file.name).join(', ');
  const extra = failed.length > 2 ? ` and ${failed.length - 2} more` : '';
  const tip = heic
    ? ' iPhone HEIC photos need to be exported as JPEG (or opened in Safari) first.'
    : '';

  if (added === 0) {
    return {
      text: `Nothing was added — ${names}${extra} could not be read.${tip}${limitText}`,
      tone: 'error',
    };
  }

  return {
    text: `${added} added, ${failed.length} skipped (${names}${extra}).${tip}${limitText}`,
    tone: 'warn',
  };
}

/**
 * Downscale an image if it exceeds MAX_TEXTURE_SIZE on its longest edge.
 * Returns { blob, width, height } with the (possibly resized) image.
 *
 * Decoding through <img> rather than createImageBitmap keeps EXIF orientation
 * and the reported width/height identical to what the museum later renders.
 * The canvas path bakes that orientation into the stored JPEG.
 */
async function processImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (width <= MAX_TEXTURE_SIZE && height <= MAX_TEXTURE_SIZE) {
      return { blob: file, width, height };
    }

    const scale = MAX_TEXTURE_SIZE / Math.max(width, height);
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, newW, newH);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9);
    });
    if (!blob) return { blob: file, width, height };
    return { blob, width: newW, height: newH };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Process and save uploaded files.
 * Accepts a FileList from an <input type="file">.
 *
 * One unreadable file (a HEIC on desktop, a corrupt download, a full quota)
 * must never discard the rest of the batch or leave the menu showing a stale
 * count, so failures are collected per file.
 *
 * @returns {Promise<{count: number, added: number, failed: Array<{name: string, reason: string, file: File}>}>}
 */
export async function handleUpload(fileList, options = {}) {
  const existingCount = Number.isFinite(Number(options.existingCount))
    ? Number(options.existingCount)
    : await getPhotoCount();
  const maxPhotos = Number(options.maxPhotos) || MUSEUM_LIMITS.maxPhotos;

  const { accepted, skipped } = partitionByPhotoLimit(fileList, existingCount, maxPhotos);
  const failed = [];
  let added = 0;

  for (const file of accepted) {
    if (file.size > MAX_INPUT_BYTES) {
      failed.push({ name: file.name, reason: 'the file is larger than 30 MB', file });
      continue;
    }

    if (file.type && !file.type.startsWith('image/')) {
      failed.push({ name: file.name, reason: 'not an image file', file });
      continue;
    }

    try {
      const { blob, width, height } = await processImage(file);
      await savePhoto({ blob, name: file.name, width, height });
      added += 1;
    } catch (error) {
      console.warn(`[upload] ${file.name} could not be added`, error);
      failed.push({ name: file.name, reason: uploadFailureReason(file, error), file });
    }
  }

  return {
    count: await getPhotoCount(),
    added,
    failed,
    limitSkipped: skipped.length,
  };
}
