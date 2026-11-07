import { getAllPhotos } from './db.js';
import { normalizeMuseumConfig } from '../core/museumConfig.js';
import { t } from '../i18n.js';

/**
 * Local preview source.
 *
 * This is the only place that knows about IndexedDB. It converts stored photo
 * blobs into a plain museum config, which is all the 3D engine ever sees.
 *
 * Shared museums bypass this module entirely: the share route loads a config
 * from the museum API and passes it to the same builder.
 */
function sampleCopy() {
  return {
    title: t('sample.title'),
    recipient: '',
    dedication: t('sample.dedication'),
    finalMessage: t('sample.finalMessage'),
  };
}

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
      date: '',
    };
  });

  const source = details && typeof details === 'object' ? details : {};
  const copy = sampleCopy();

  return {
    config: normalizeMuseumConfig({
      title: source.title || copy.title,
      recipient: source.recipient ?? copy.recipient,
      dedication: source.dedication ?? copy.dedication,
      finalMessage: source.finalMessage ?? copy.finalMessage,
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
