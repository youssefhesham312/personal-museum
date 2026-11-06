/**
 * Validation shared by the Edge Function and the browser.
 *
 * This module is deliberately free of Deno, Node and DOM APIs so the same
 * rules can be unit tested with Vitest and imported by the client bundle.
 */

export const MUSEUM_LIMITS = Object.freeze({
  minPhotos: 5,
  maxPhotos: 15,
  maxPhotoBytes: 2 * 1024 * 1024,
  maxTotalPhotoBytes: 20 * 1024 * 1024,
  maxTitleLength: 200,
  maxNameLength: 200,
  maxDedicationLength: 2000,
  maxFinalMessageLength: 4000,
  maxCaptionLength: 400,
  maxDateLength: 120,
  maxDimension: 8192,
  allowedContentTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
});

export const CONTENT_TYPE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

/** Collapse runs of whitespace (title, names, captions). */
export function cleanLine(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Keep intentional paragraph breaks but tidy each line. */
export function cleanBlock(value, maxLength) {
  if (typeof value !== 'string') return '';
  const lines = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());

  const collapsed = [];
  for (const line of lines) {
    if (line === '' && collapsed[collapsed.length - 1] === '') continue;
    collapsed.push(line);
  }

  return collapsed.join('\n').trim().slice(0, maxLength);
}

function asInteger(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  return num;
}

/**
 * Validate and normalize the JSON body accepted by POST /museums.
 *
 * The server assigns photo positions from the array order; a client cannot
 * choose its own order keys, storage path, timestamps or museum id.
 *
 * @param {unknown} input
 * @param {typeof MUSEUM_LIMITS} [limits]
 * @returns {{ok: boolean, errors: string[], fields: Record<string, string>, value: object|null}}
 */
export function validateMuseumInput(input, limits = MUSEUM_LIMITS) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, string>} */
  const fields = {};

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: ['The request body must be a JSON object.'],
      fields,
      value: null,
    };
  }

  const title = cleanLine(input.title, limits.maxTitleLength);
  const recipient = cleanLine(input.recipient, limits.maxNameLength);
  const dedication = cleanBlock(input.dedication, limits.maxDedicationLength);
  const finalMessage = cleanBlock(input.finalMessage, limits.maxFinalMessageLength);

  if (!title) fields.title = 'A museum title is required.';
  if (!recipient) fields.recipient = "The recipient's name is required.";
  if (!finalMessage) fields.finalMessage = 'A closing message is required.';

  const rawPhotos = Array.isArray(input.photos) ? input.photos : [];
  if (rawPhotos.length < limits.minPhotos || rawPhotos.length > limits.maxPhotos) {
    errors.push(`Add between ${limits.minPhotos} and ${limits.maxPhotos} photos.`);
  }

  /** @type {Array<object>} */
  const photos = [];
  let totalBytes = 0;

  for (let index = 0; index < rawPhotos.length; index += 1) {
    const raw = rawPhotos[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`Photo ${index + 1} is missing its metadata.`);
      continue;
    }

    const contentType = String(raw.contentType || '').toLowerCase();
    const byteSize = asInteger(raw.byteSize ?? raw.size);
    const width = asInteger(raw.width);
    const height = asInteger(raw.height);
    const caption = cleanLine(raw.caption, limits.maxCaptionLength);
    const dateLabel = cleanLine(raw.dateLabel ?? raw.date, limits.maxDateLength);

    if (!limits.allowedContentTypes.includes(contentType)) {
      errors.push(`Photo ${index + 1} must be a JPEG, PNG or WebP image.`);
    }
    if (byteSize === null || byteSize <= 0 || byteSize > limits.maxPhotoBytes) {
      errors.push(`Photo ${index + 1} must be smaller than ${Math.round(limits.maxPhotoBytes / (1024 * 1024))} MB.`);
    }
    if (width === null || height === null || width <= 0 || height <= 0 || width > limits.maxDimension || height > limits.maxDimension) {
      errors.push(`Photo ${index + 1} has an invalid size.`);
    }

    if (byteSize !== null && byteSize > 0) totalBytes += byteSize;

    photos.push({
      position: index,
      contentType,
      byteSize,
      width,
      height,
      caption,
      dateLabel,
    });
  }

  if (totalBytes > limits.maxTotalPhotoBytes) {
    errors.push(`The photographs total more than ${Math.round(limits.maxTotalPhotoBytes / (1024 * 1024))} MB.`);
  }

  const ok = errors.length === 0 && Object.keys(fields).length === 0;

  return {
    ok,
    errors,
    fields,
    value: ok
      ? { title, recipient, dedication, finalMessage, photos }
      : null,
  };
}

/**
 * The delay before an unfinished museum (created but never completed) is
 * treated as abandoned. It must be long enough for a slow mobile upload.
 */
export const DRAFT_GRACE_MS = 60 * 60 * 1000;
