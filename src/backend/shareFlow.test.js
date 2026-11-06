import { describe, expect, it, vi } from 'vitest';
import { MuseumApiError } from './api.js';
import { createShareableMuseum } from './shareFlow.js';

const PUBLIC_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const EXPIRES = '2026-11-02T12:00:00.000Z';

const DETAILS = {
  title: '  Moments for Noor ',
  recipient: ' Noor ',
  dedication: ' For the years we keep. ',
  finalMessage: ' Thank you for walking through this. ',
};

function makePhotos(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    blob: new Blob([`photo-${index}`], { type: 'image/jpeg' }),
    caption: ` Caption ${index} `,
    date: ` 202${index} `,
  }));
}

function makeApi(overrides = {}) {
  return {
    createMuseumDraft: vi.fn(async () => ({
      museumId: 'museum-uuid',
      completionToken: 'completion-token',
      uploads: Array.from({ length: 5 }, (_, index) => ({
        position: index,
        signedUrl: `https://upload/${index}`,
      })),
    })),
    completeMuseum: vi.fn(async () => ({ publicId: PUBLIC_ID, expiresAt: EXPIRES })),
    abortMuseum: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeOptimize() {
  return vi.fn(async (file) => ({
    blob: file,
    width: 800,
    height: 600,
    contentType: 'image/webp',
  }));
}

function makeUpload() {
  return vi.fn(async () => undefined);
}

describe('createShareableMuseum', () => {
  it('runs the whole flow and returns the share identifiers', async () => {
    const photos = makePhotos(5);
    const api = makeApi();
    const optimize = makeOptimize();
    const upload = makeUpload();
    const phases = [];

    const result = await createShareableMuseum({
      photos,
      details: DETAILS,
      optimize,
      upload,
      api,
      onProgress: (progress) => phases.push(progress.phase),
    });

    expect(result).toEqual({
      museumId: 'museum-uuid',
      publicId: PUBLIC_ID,
      expiresAt: EXPIRES,
    });
    expect(phases).toEqual([
      'preparing',
      'preparing',
      'preparing',
      'preparing',
      'preparing',
      'creating',
      'uploading',
      'finalizing',
      'done',
    ]);
  });

  it('normalizes details and sends server-controlled photo metadata', async () => {
    const photos = makePhotos(5);
    const api = makeApi();
    const upload = makeUpload();

    await createShareableMuseum({
      photos,
      details: DETAILS,
      optimize: makeOptimize(),
      upload,
      api,
    });

    const [body] = api.createMuseumDraft.mock.calls[0];
    expect(body).toMatchObject({
      title: 'Moments for Noor',
      recipient: 'Noor',
      dedication: 'For the years we keep.',
      finalMessage: 'Thank you for walking through this.',
    });
    expect(body.photos).toHaveLength(5);
    expect(body.photos[0]).toEqual({
      position: 0,
      contentType: 'image/webp',
      byteSize: photos[0].blob.size,
      width: 800,
      height: 600,
      caption: 'Caption 0',
      dateLabel: '2020',
    });
    expect(body.photos.map((photo) => photo.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('uploads the optimized files in plan order', async () => {
    const photos = makePhotos(5);
    const api = makeApi();
    const upload = makeUpload();
    const optimize = vi.fn(async (file) => ({
      blob: new Blob([`optimized-${file.size}`], { type: 'image/webp' }),
      width: 100,
      height: 50,
      contentType: 'image/webp',
    }));

    await createShareableMuseum({ photos, details: DETAILS, optimize, upload, api });

    const [uploads, uploadedPhotos] = upload.mock.calls[0];
    expect(uploads).toBe((await api.createMuseumDraft.mock.results[0].value).uploads);
    expect(uploadedPhotos).toHaveLength(5);
    expect(uploadedPhotos.every((photo) => photo.contentType === 'image/webp')).toBe(true);
  });

  it('derives a per-photo budget from the server total-size limit', async () => {
    const photos = makePhotos(15);
    const api = makeApi({
      createMuseumDraft: vi.fn(async () => ({
        museumId: 'museum-uuid',
        completionToken: 'completion-token',
        uploads: Array.from({ length: 15 }, (_, index) => ({
          position: index,
          signedUrl: `https://upload/${index}`,
        })),
      })),
    });
    const optimize = makeOptimize();

    await createShareableMuseum({
      photos,
      details: DETAILS,
      optimize,
      upload: makeUpload(),
      api,
    });

    const expectedBudget = Math.floor((20 * 1024 * 1024) / 15);
    expect(optimize.mock.calls[0][1]).toEqual({ maxBytes: expectedBudget });
    expect(expectedBudget).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('rejects a batch that is still too large after optimisation', async () => {
    const api = makeApi();
    const optimize = vi.fn(async () => ({
      blob: { size: 1.5 * 1024 * 1024 },
      width: 1600,
      height: 1200,
      contentType: 'image/webp',
    }));

    await expect(createShareableMuseum({
      photos: makePhotos(15),
      details: DETAILS,
      optimize,
      upload: makeUpload(),
      api,
    })).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringContaining('too large together'),
    });

    expect(api.createMuseumDraft).not.toHaveBeenCalled();
  });

  it('rejects an empty or short photo list before calling the API', async () => {
    const api = makeApi();

    await expect(createShareableMuseum({
      photos: [],
      details: DETAILS,
      api,
    })).rejects.toMatchObject({ code: 'invalid' });

    await expect(createShareableMuseum({
      photos: makePhotos(4),
      details: DETAILS,
      api,
    })).rejects.toMatchObject({
      code: 'invalid',
      errors: [expect.stringContaining('at least 5')],
    });

    expect(api.createMuseumDraft).not.toHaveBeenCalled();
  });

  it('rejects incomplete details before optimizing', async () => {
    const api = makeApi();
    const optimize = vi.fn();

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: { title: '', recipient: '', finalMessage: '' },
      optimize,
      api,
    })).rejects.toMatchObject({
      code: 'invalid',
      fields: {
        title: expect.any(String),
        recipient: expect.any(String),
        finalMessage: expect.any(String),
      },
    });

    expect(optimize).not.toHaveBeenCalled();
    expect(api.createMuseumDraft).not.toHaveBeenCalled();
  });

  it('rejects a photo without a blob', async () => {
    const api = makeApi();
    await expect(createShareableMuseum({
      photos: [{ blob: null }, ...makePhotos(4)],
      details: DETAILS,
      optimize: makeOptimize(),
      api,
    })).rejects.toMatchObject({
      code: 'invalid',
      message: 'Photograph 1 is missing.',
    });
  });

  it('does nothing when the caller has already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const api = makeApi();
    const optimize = vi.fn();

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize,
      api,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });

    expect(optimize).not.toHaveBeenCalled();
    expect(api.createMuseumDraft).not.toHaveBeenCalled();
  });

  it('stops between photos when cancelled and never creates a draft', async () => {
    const controller = new AbortController();
    const api = makeApi();
    const optimize = vi.fn(async (file) => {
      controller.abort();
      return { blob: file, width: 10, height: 10, contentType: 'image/jpeg' };
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize,
      api,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });

    expect(optimize).toHaveBeenCalledTimes(1);
    expect(api.createMuseumDraft).not.toHaveBeenCalled();
  });

  it('aborts the draft when an upload fails and preserves the original error', async () => {
    const api = makeApi();
    const failure = new MuseumApiError('upload_failed', 'The upload failed.', { status: 500 });
    const upload = vi.fn(async () => {
      throw failure;
    });

    const error = await createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload,
      api,
    }).catch((reason) => reason);

    expect(error).toBe(failure);
    expect(error.cleanupPending).toBe(false);
    expect(api.abortMuseum).toHaveBeenCalledWith({
      museumId: 'museum-uuid',
      token: 'completion-token',
    });
    expect(api.completeMuseum).not.toHaveBeenCalled();
  });

  it('aborts the draft when finalization fails', async () => {
    const api = makeApi({
      completeMuseum: vi.fn(async () => {
        throw new MuseumApiError('incomplete', 'Missing photos.', { status: 409 });
      }),
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: makeUpload(),
      api,
    })).rejects.toMatchObject({ code: 'incomplete' });

    expect(api.abortMuseum).toHaveBeenCalledTimes(1);
  });

  it('retries finalization once after a network error', async () => {
    const api = makeApi({
      completeMuseum: vi.fn()
        .mockRejectedValueOnce(new MuseumApiError('network', 'Response was lost.'))
        .mockResolvedValueOnce({ publicId: PUBLIC_ID, expiresAt: EXPIRES }),
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: makeUpload(),
      api,
    })).resolves.toMatchObject({ publicId: PUBLIC_ID, expiresAt: EXPIRES });

    expect(api.completeMuseum).toHaveBeenCalledTimes(2);
    expect(api.abortMuseum).not.toHaveBeenCalled();
  });

  it('retries finalization once after an unavailable error', async () => {
    const api = makeApi({
      completeMuseum: vi.fn()
        .mockRejectedValueOnce(new MuseumApiError('unavailable', 'Try again.', { status: 503 }))
        .mockResolvedValueOnce({ publicId: PUBLIC_ID, expiresAt: EXPIRES }),
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: makeUpload(),
      api,
    })).resolves.toMatchObject({ publicId: PUBLIC_ID });

    expect(api.completeMuseum).toHaveBeenCalledTimes(2);
  });

  it('does not retry a validation failure during finalization', async () => {
    const api = makeApi({
      completeMuseum: vi.fn(async () => {
        throw new MuseumApiError('incomplete', 'Missing photos.', { status: 409 });
      }),
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: makeUpload(),
      api,
    })).rejects.toMatchObject({ code: 'incomplete' });

    expect(api.completeMuseum).toHaveBeenCalledTimes(1);
  });

  it('aborts when the retried finalization also fails', async () => {
    const api = makeApi({
      completeMuseum: vi.fn(async () => {
        throw new MuseumApiError('network', 'Still offline.');
      }),
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: makeUpload(),
      api,
    })).rejects.toMatchObject({ code: 'network' });

    expect(api.completeMuseum).toHaveBeenCalledTimes(2);
    expect(api.abortMuseum).toHaveBeenCalledTimes(1);
  });

  it('flags cleanup as pending when the abort itself fails', async () => {
    const failure = new MuseumApiError('upload_failed', 'The upload failed.', { status: 500 });
    const api = makeApi({
      abortMuseum: vi.fn(async () => {
        throw new Error('cleanup endpoint down');
      }),
    });

    const error = await createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: vi.fn(async () => {
        throw failure;
      }),
      api,
    }).catch((reason) => reason);

    expect(error).toBe(failure);
    expect(error.cleanupPending).toBe(true);
  });

  it('does not try to abort when draft creation itself fails', async () => {
    const api = makeApi({
      createMuseumDraft: vi.fn(async () => {
        throw new MuseumApiError('network', 'Offline.');
      }),
    });

    await expect(createShareableMuseum({
      photos: makePhotos(5),
      details: DETAILS,
      optimize: makeOptimize(),
      upload: makeUpload(),
      api,
    })).rejects.toMatchObject({ code: 'network' });

    expect(api.abortMuseum).not.toHaveBeenCalled();
  });
});
