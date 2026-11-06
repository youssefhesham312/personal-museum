import { validateCreatorDetails } from './creatorValidation.js';
import { MAX_UPLOAD_BYTES, optimizePhotoForUpload } from './photoOptimize.js';
import { uploadAll } from './upload.js';
import {
  MUSEUM_LIMITS,
  cleanLine,
} from '../../supabase/functions/_shared/validation.js';
import {
  abortMuseum,
  completeMuseum,
  createMuseumDraft,
  MuseumApiError,
} from './api.js';

/**
 * Finalization is idempotent on the server. Retrying once after a network or
 * availability error recovers the common case where the response was lost
 * after the museum was already made readable.
 */
async function finalizeMuseum(api, payload) {
  try {
    return await api.completeMuseum(payload);
  } catch (error) {
    if (error?.code !== 'network' && error?.code !== 'unavailable') throw error;
    return api.completeMuseum(payload);
  }
}

/**
 * Full creator flow:
 *   1. validate the details and photo count
 *   2. optimize every photo in the browser
 *   3. create a server-owned draft with signed upload URLs
 *   4. upload with progress
 *   5. finalize (server verifies every object, then makes the museum readable)
 *
 * If anything fails after the draft exists, the draft is aborted. If aborting
 * also fails, the hourly cleanup job removes the draft and its files; the
 * original error is never masked.
 */
export async function createShareableMuseum(options) {
  const {
    photos,
    details,
    onProgress,
    signal,
    optimize = optimizePhotoForUpload,
    upload = uploadAll,
    api = { createMuseumDraft, completeMuseum, abortMuseum },
  } = options ?? {};

  if (!Array.isArray(photos) || photos.length === 0) {
    throw new MuseumApiError('invalid', 'Add between 5 and 15 photographs.');
  }

  const validation = validateCreatorDetails(details, photos.length);
  if (!validation.ok) {
    throw new MuseumApiError('invalid', 'Please check the museum details.', {
      fields: validation.fields,
      errors: validation.errors,
    });
  }

  if (signal?.aborted) {
    throw new MuseumApiError('cancelled', 'Cancelled.');
  }

  const optimized = [];
  // The server rejects a batch over 20 MB. Keep the per-photo budget inside
  // that total as well as the normal 1.5 MB client cap, so 15 photos cannot
  // pass client validation and then fail on the server.
  const maxBytesPerPhoto = Math.min(
    MAX_UPLOAD_BYTES,
    Math.floor(MUSEUM_LIMITS.maxTotalPhotoBytes / photos.length)
  );

  for (let index = 0; index < photos.length; index += 1) {
    if (signal?.aborted) {
      throw new MuseumApiError('cancelled', 'Cancelled.');
    }

    onProgress?.({ phase: 'preparing', index, total: photos.length });

    const source = photos[index];
    if (!source?.blob) {
      throw new MuseumApiError('invalid', `Photograph ${index + 1} is missing.`);
    }

    const prepared = await optimize(source.blob, { maxBytes: maxBytesPerPhoto });
    optimized.push({
      blob: prepared.blob,
      width: prepared.width,
      height: prepared.height,
      contentType: prepared.contentType,
      caption: cleanLine(source.caption, MUSEUM_LIMITS.maxCaptionLength),
      dateLabel: cleanLine(source.date, MUSEUM_LIMITS.maxDateLength),
    });
  }

  const optimizedBytes = optimized.reduce((sum, photo) => sum + photo.blob.size, 0);
  if (optimizedBytes > MUSEUM_LIMITS.maxTotalPhotoBytes) {
    throw new MuseumApiError(
      'invalid',
      'The photographs are too large together. Try fewer or smaller photographs.'
    );
  }

  onProgress?.({ phase: 'creating' });

  const draft = await api.createMuseumDraft({
    ...validation.value,
    photos: optimized.map((photo, index) => ({
      position: index,
      contentType: photo.contentType,
      byteSize: photo.blob.size,
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
      dateLabel: photo.dateLabel,
    })),
  });

  try {
    onProgress?.({
      phase: 'uploading',
      completed: 0,
      total: optimized.length,
      loadedBytes: 0,
      totalBytes: optimized.reduce((sum, photo) => sum + photo.blob.size, 0),
    });

    await upload(
      draft.uploads,
      optimized.map((photo) => ({ blob: photo.blob, contentType: photo.contentType })),
      {
        signal,
        onProgress: (progress) => {
          onProgress?.({ phase: 'uploading', ...progress });
        },
      }
    );

    onProgress?.({ phase: 'finalizing' });

    const finished = await finalizeMuseum(api, {
      museumId: draft.museumId,
      token: draft.completionToken,
    });

    onProgress?.({ phase: 'done' });

    return {
      museumId: draft.museumId,
      publicId: finished.publicId,
      expiresAt: finished.expiresAt,
    };
  } catch (error) {
    let cleanupPending = false;

    try {
      await api.abortMuseum({
        museumId: draft.museumId,
        token: draft.completionToken,
      });
    } catch (abortError) {
      cleanupPending = true;
      console.warn('[museum] draft cleanup will be retried by the scheduled job', abortError?.message);
    }

    if (error && typeof error === 'object') {
      error.cleanupPending = cleanupPending;
    }

    throw error;
  }
}
