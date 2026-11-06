/**
 * Museum configuration.
 *
 * The 3D engine must never read storage. Everything it needs to render a
 * museum arrives through this normalized configuration object.
 */

const DEFAULT_PHOTO_WIDTH = 1600;
const DEFAULT_PHOTO_HEIGHT = 1200;
const DEFAULT_TITLE = 'Personal Museum';
const MAX_TEXT_LENGTH = 4000;

/**
 * Collapse runs of whitespace (title, names, captions).
 */
function cleanLine(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Keep intentional line breaks but tidy each line (dedication, final message).
 */
function cleanBlock(value, maxLength = MAX_TEXT_LENGTH) {
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

function positiveInt(value, fallback, max = 20000) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(Math.round(num), max);
}

/**
 * Normalize arbitrary input into the shape the museum builder expects.
 *
 * @param {object} input
 * @returns {{
 *   title: string,
 *   recipient: string,
 *   dedication: string,
 *   finalMessage: string,
 *   photos: Array<{id: string, url: string, width: number, height: number, caption: string, date: string}>
 * }}
 */
export function normalizeMuseumConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};

  const rawPhotos = Array.isArray(source.photos) ? source.photos : [];
  const photos = [];

  for (const raw of rawPhotos) {
    if (!raw || typeof raw !== 'object') continue;
    const url = typeof raw.url === 'string' ? raw.url.trim() : '';
    if (!url) continue;

    photos.push({
      id: cleanLine(raw.id, 200) || `photo-${photos.length + 1}`,
      url,
      width: positiveInt(raw.width, DEFAULT_PHOTO_WIDTH),
      height: positiveInt(raw.height, DEFAULT_PHOTO_HEIGHT),
      caption: cleanLine(raw.caption, 400),
      date: cleanLine(raw.date, 120),
    });
  }

  return {
    title: cleanLine(source.title, 200) || DEFAULT_TITLE,
    recipient: cleanLine(source.recipient, 200),
    dedication: cleanBlock(source.dedication),
    finalMessage: cleanBlock(source.finalMessage),
    photos,
  };
}

/**
 * True when the config has enough content to build a museum.
 */
export function isBuildableConfig(config) {
  return Boolean(config && Array.isArray(config.photos) && config.photos.length > 0);
}
