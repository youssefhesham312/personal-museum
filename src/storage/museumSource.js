import { getAllPhotos } from './db.js';
import { normalizeMuseumConfig } from '../core/museumConfig.js';

/**
 * Local preview source.
 *
 * This is the only place that knows about IndexedDB. It converts stored photo
 * blobs into a plain museum config, which is all the 3D engine ever sees.
 *
 * Shared museums bypass this module entirely: the share route loads a config
 * from the museum API and passes it to the same builder.
 */
const SAMPLE_COPY = {
  title: 'The Personal Museum',
  recipient: '',
  dedication:
    'A small collection of moments, kept for you.\nWalk slowly — each room holds something worth remembering.',
  finalMessage:
    'Thank you for walking through these memories.\n\nSome places exist only for two people. This one is yours.',
};

export async function loadMuseumConfigFromStorage(details = {}) {
  const photos = await getAllPhotos();
  const objectUrls = [];

  const mapped = photos.map((photo) => {
    const url = URL.createObjectURL(photo.blob);
    objectUrls.push(url);
    return {
      id: String(photo.id),
      url,
      width: photo.width,
      height: photo.height,
      caption: photo.caption || '',
      date: photo.date || '',
    };
  });

  const source = details && typeof details === 'object' ? details : {};

  return {
    config: normalizeMuseumConfig({
      title: source.title || SAMPLE_COPY.title,
      recipient: source.recipient ?? SAMPLE_COPY.recipient,
      dedication: source.dedication ?? SAMPLE_COPY.dedication,
      finalMessage: source.finalMessage ?? SAMPLE_COPY.finalMessage,
      photos: mapped,
    }),
    objectUrls,
  };
}

export function revokeObjectUrls(urls) {
  if (!Array.isArray(urls)) return;
  for (const url of urls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
}
