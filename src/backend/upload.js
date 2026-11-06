import { MuseumApiError } from './api.js';

const UPLOAD_TIMEOUT_MS = 120_000;

function statusMessage(status) {
  if (status === 413) return 'This photograph is too large to upload.';
  if (status === 401 || status === 403) {
    return 'The upload permission expired. Please try again.';
  }
  return 'This photograph could not be uploaded. Please try again.';
}

/**
 * PUT one optimized photo to a Cloudflare R2 presigned upload URL.
 *
 * XMLHttpRequest is used instead of fetch solely because it exposes upload
 * progress. No R2 credential is sent: the signature, expiry and allowed
 * content type are already in the URL. The `Content-Type` header must match
 * the value the server signed. A retry PUTs the same key again, which R2
 * overwrites idempotently; finalize still verifies size and type.
 */
export function uploadToSignedUrl(signedUrl, blob, contentType, options = {}) {
  const xhr = options.xhrFactory ? options.xhrFactory() : new XMLHttpRequest();
  const signal = options.signal ?? null;
  const onProgress = options.onProgress;

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const handleAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* already finished */
      }
      finish(reject, new MuseumApiError('cancelled', 'Upload cancelled.'));
    };

    if (signal?.aborted) {
      finish(reject, new MuseumApiError('cancelled', 'Upload cancelled.'));
      return;
    }

    try {
      xhr.open('PUT', signedUrl, true);
      // R2 signs this exact header value. Do not add credentials or custom
      // x-upsert headers: they are neither needed nor part of the signature.
      xhr.setRequestHeader('Content-Type', contentType);
    } catch (error) {
      finish(reject, new MuseumApiError('upload_failed', 'The upload could not be prepared.', { cause: error }));
      return;
    }

    xhr.timeout = options.timeoutMs ?? UPLOAD_TIMEOUT_MS;

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (!event || !event.lengthComputable) return;
        onProgress?.({ loaded: event.loaded, total: event.total });
      };
    }

    xhr.onload = () => {
      const status = Number(xhr.status) || 0;

      // R2 overwrites an existing key on a retried PUT, so any 2xx is success.
      if (status >= 200 && status < 300) {
        finish(resolve, { status });
        return;
      }

      finish(
        reject,
        new MuseumApiError('upload_failed', statusMessage(status), { status })
      );
    };

    xhr.onerror = () => {
      finish(
        reject,
        new MuseumApiError(
          'upload_failed',
          'The photograph could not be uploaded. Check your connection and try again.',
          { status: Number(xhr.status) || 0 }
        )
      );
    };

    xhr.ontimeout = () => {
      finish(
        reject,
        new MuseumApiError('upload_failed', 'The upload timed out. Check your connection and try again.', {
          status: 0,
        })
      );
    };

    xhr.onabort = () => {
      finish(reject, new MuseumApiError('cancelled', 'Upload cancelled.'));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    try {
      xhr.send(blob);
    } catch (error) {
      finish(reject, new MuseumApiError('upload_failed', 'The photograph could not be uploaded.', { cause: error }));
    }
  });
}

function shouldRetry(error) {
  if (!(error instanceof MuseumApiError) || error.code !== 'upload_failed') return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Upload every signed file with bounded concurrency and aggregate progress.
 * On the first unrecoverable failure the other in-flight uploads are cancelled
 * so the caller can abort the draft and leave no half-finished museum.
 */
export async function uploadAll(uploads, photos, options = {}) {
  if (!Array.isArray(uploads) || !Array.isArray(photos) || uploads.length !== photos.length) {
    throw new MuseumApiError('upload_failed', 'The upload plan is invalid.');
  }

  const total = uploads.length;
  if (total === 0) return;

  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 2, total));
  const uploadFn = options.uploadFn ?? uploadToSignedUrl;
  const onProgress = options.onProgress;
  const externalSignal = options.signal ?? null;

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new MuseumApiError('cancelled', 'Upload cancelled.');
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const sizes = photos.map((photo) => Number(photo?.blob?.size) || 0);
  const loadedByIndex = new Array(total).fill(0);
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  let completed = 0;
  let failure = null;

  const report = () => {
    const loadedBytes = loadedByIndex.reduce((sum, value) => sum + value, 0);
    onProgress?.({ completed, total, loadedBytes, totalBytes });
  };

  const runOne = async (index) => {
    const photo = photos[index];
    const upload = uploads[index];

    const attempt = async () => {
      loadedByIndex[index] = 0;
      return uploadFn(upload.signedUrl, photo.blob, photo.contentType, {
        signal: controller.signal,
        onProgress: ({ loaded, total: fileTotal }) => {
          const size = sizes[index] || fileTotal || 0;
          loadedByIndex[index] = size > 0 ? Math.min(loaded, size) : loaded;
          report();
        },
      });
    };

    try {
      await attempt();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (!shouldRetry(error)) throw error;
      await attempt();
    }

    loadedByIndex[index] = sizes[index] || loadedByIndex[index];
    completed += 1;
    report();
  };

  const worker = async () => {
    while (true) {
      if (failure) return;
      if (controller.signal.aborted) {
        throw new MuseumApiError('cancelled', 'Upload cancelled.');
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;

      try {
        await runOne(index);
      } catch (error) {
        if (!failure) {
          failure = error;
          controller.abort();
        }
        throw error;
      }
    }
  };

  let nextIndex = 0;
  const outcomes = await Promise.allSettled(
    Array.from({ length: concurrency }, () => worker())
  );

  externalSignal?.removeEventListener('abort', onExternalAbort);

  if (failure) throw failure;

  if (externalSignal?.aborted || controller.signal.aborted) {
    throw new MuseumApiError('cancelled', 'Upload cancelled.');
  }

  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  if (rejected) throw rejected.reason;

  report();
}
