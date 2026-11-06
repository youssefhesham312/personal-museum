import { describe, expect, it, vi } from 'vitest';
import { MuseumApiError } from './api.js';
import { uploadAll, uploadToSignedUrl } from './upload.js';

class FakeXhr {
  constructor() {
    this.upload = {};
    this.headers = {};
    this.status = 0;
    this.responseText = '';
    this.aborted = false;
    this.timeout = 0;
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  send(body) {
    this.sent = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

function blob(size = 3, type = 'image/jpeg') {
  return new Blob(['x'.repeat(size)], { type });
}

function plan(count) {
  return {
    uploads: Array.from({ length: count }, (_, index) => ({ signedUrl: `https://upload/${index}` })),
    photos: Array.from({ length: count }, () => ({ blob: blob(10), contentType: 'image/jpeg' })),
  };
}

describe('uploadToSignedUrl', () => {
  it('PUTs the file with its content type and reports progress', async () => {
    const xhr = new FakeXhr();
    const onProgress = vi.fn();
    const file = blob(12);

    const promise = uploadToSignedUrl('https://upload/0', file, 'image/jpeg', {
      xhrFactory: () => xhr,
      onProgress,
      timeoutMs: 1234,
    });

    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe('https://upload/0');
    expect(xhr.headers).toEqual({
      'Content-Type': 'image/jpeg',
    });
    expect(xhr.timeout).toBe(1234);
    expect(xhr.sent).toBe(file);

    xhr.upload.onprogress({ lengthComputable: true, loaded: 6, total: 12 });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 6, total: 12 });

    xhr.upload.onprogress({ lengthComputable: false, loaded: 6, total: 12 });
    expect(onProgress).toHaveBeenCalledTimes(1);

    xhr.status = 200;
    xhr.onload();
    await expect(promise).resolves.toEqual({ status: 200 });
  });

  it('treats a retried R2 PUT overwrite as success', async () => {
    for (const status of [200, 201, 204]) {
      const xhr = new FakeXhr();
      const promise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
        xhrFactory: () => xhr,
      });
      xhr.status = status;
      xhr.onload();
      await expect(promise).resolves.toEqual({ status });
    }
  });

  it('rejects an ordinary 400 response', async () => {
    const xhr = new FakeXhr();
    const promise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => xhr,
    });
    xhr.status = 400;
    xhr.responseText = 'bad request';
    xhr.onload();

    const error = await promise.catch((reason) => reason);
    expect(error).toBeInstanceOf(MuseumApiError);
    expect(error.code).toBe('upload_failed');
    expect(error.status).toBe(400);
  });

  it('does not treat a 409 as success', async () => {
    const xhr = new FakeXhr();
    const promise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => xhr,
    });
    xhr.status = 409;
    xhr.onload();

    await expect(promise).rejects.toMatchObject({
      code: 'upload_failed',
      status: 409,
    });
  });

  it('maps large-file and permission responses to helpful messages', async () => {
    const cases = [
      [413, /too large/],
      [401, /permission expired/],
      [403, /permission expired/],
      [500, /could not be uploaded/],
    ];

    for (const [status, message] of cases) {
      const xhr = new FakeXhr();
      const promise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
        xhrFactory: () => xhr,
      });
      xhr.status = status;
      xhr.onload();
      const error = await promise.catch((reason) => reason);
      expect(error.status).toBe(status);
      expect(error.message).toMatch(message);
    }
  });

  it('maps network, timeout and send failures', async () => {
    const network = new FakeXhr();
    const networkPromise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => network,
    });
    network.onerror();
    await expect(networkPromise).rejects.toMatchObject({
      code: 'upload_failed',
      message: expect.stringMatching(/Check your connection/),
    });

    const timeout = new FakeXhr();
    const timeoutPromise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => timeout,
    });
    timeout.ontimeout();
    await expect(timeoutPromise).rejects.toMatchObject({
      message: expect.stringMatching(/timed out/),
    });

    const sender = new FakeXhr();
    sender.send = () => {
      throw new Error('send failed');
    };
    const sendPromise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => sender,
    });
    await expect(sendPromise).rejects.toMatchObject({
      code: 'upload_failed',
      message: 'The photograph could not be uploaded.',
    });
  });

  it('maps a setup failure to upload_failed', async () => {
    const xhr = new FakeXhr();
    xhr.open = () => {
      throw new Error('bad url');
    };
    const promise = uploadToSignedUrl('not a url', blob(), 'image/jpeg', {
      xhrFactory: () => xhr,
    });
    await expect(promise).rejects.toMatchObject({
      code: 'upload_failed',
      message: 'The upload could not be prepared.',
    });
  });

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const xhr = new FakeXhr();

    const promise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => xhr,
      signal: controller.signal,
    });

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(xhr.method).toBeUndefined();
  });

  it('aborts the request when the caller cancels', async () => {
    const controller = new AbortController();
    const xhr = new FakeXhr();

    const promise = uploadToSignedUrl('https://upload/0', blob(), 'image/jpeg', {
      xhrFactory: () => xhr,
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(xhr.aborted).toBe(true);
  });
});

describe('uploadAll', () => {
  it('rejects a mismatched upload plan', async () => {
    await expect(uploadAll([{ signedUrl: 'a' }], []))
      .rejects.toMatchObject({ code: 'upload_failed' });
    await expect(uploadAll(null, []))
      .rejects.toMatchObject({ code: 'upload_failed' });
  });

  it('resolves an empty plan', async () => {
    await expect(uploadAll([], [])).resolves.toBeUndefined();
  });

  it('uploads every file and aggregates byte progress', async () => {
    const { uploads, photos } = plan(3);
    const progress = [];
    const uploadFn = vi.fn(async () => undefined);

    await uploadAll(uploads, photos, {
      uploadFn,
      concurrency: 2,
      onProgress: (value) => progress.push(value),
    });

    expect(uploadFn).toHaveBeenCalledTimes(3);
    expect(uploadFn.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://upload/0',
      'https://upload/1',
      'https://upload/2',
    ]);
    expect(progress.at(-1)).toEqual({
      completed: 3,
      total: 3,
      loadedBytes: 30,
      totalBytes: 30,
    });
  });

  it('reports per-file loaded bytes safely clamped to the file size', async () => {
    const { uploads, photos } = plan(1);
    const progress = [];

    await uploadAll(uploads, photos, {
      uploadFn: async (url, file, type, options) => {
        options.onProgress({ loaded: 50, total: 10 });
        options.onProgress({ loaded: 10, total: 10 });
      },
      onProgress: (value) => progress.push(value),
    });

    expect(progress.some((entry) => entry.loadedBytes === 10)).toBe(true);
    expect(progress.at(-1).loadedBytes).toBe(10);
  });

  it('retries one transient failure', async () => {
    const { uploads, photos } = plan(1);
    let attempts = 0;
    const uploadFn = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new MuseumApiError('upload_failed', 'temporary', { status: 503 });
      }
    });

    await uploadAll(uploads, photos, { uploadFn });
    expect(attempts).toBe(2);
  });

  it('stops after the retry when the failure is permanent', async () => {
    const { uploads, photos } = plan(1);
    let attempts = 0;
    const uploadFn = vi.fn(async () => {
      attempts += 1;
      throw new MuseumApiError('upload_failed', 'still broken', { status: 500 });
    });

    await expect(uploadAll(uploads, photos, { uploadFn }))
      .rejects.toMatchObject({ message: 'still broken' });
    expect(attempts).toBe(2);
  });

  it('does not retry a non-transient upload error', async () => {
    const { uploads, photos } = plan(1);
    const uploadFn = vi.fn(async () => {
      throw new MuseumApiError('upload_failed', 'bad type', { status: 400 });
    });

    await expect(uploadAll(uploads, photos, { uploadFn }))
      .rejects.toMatchObject({ status: 400 });
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });

  it('cancels other in-flight uploads and rethrows the first failure', async () => {
    const { uploads, photos } = plan(2);
    let otherSignal = null;

    const uploadFn = vi.fn((url, blob, type, options) => {
      if (url === 'https://upload/0') {
        return Promise.reject(new MuseumApiError('upload_failed', 'permanent', { status: 500 }));
      }
      otherSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new MuseumApiError('cancelled', 'Upload cancelled.'));
        });
      });
    });

    const error = await uploadAll(uploads, photos, {
      uploadFn,
      concurrency: 2,
    }).catch((reason) => reason);

    expect(error).toMatchObject({ code: 'upload_failed', message: 'permanent' });
    expect(otherSignal).not.toBeNull();
    expect(otherSignal.aborted).toBe(true);
  });

  it('cancels when the caller aborts before starting', async () => {
    const { uploads, photos } = plan(1);
    const controller = new AbortController();
    controller.abort();

    await expect(uploadAll(uploads, photos, {
      uploadFn: vi.fn(),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('cancels an in-flight upload when the caller aborts', async () => {
    const { uploads, photos } = plan(1);
    const controller = new AbortController();

    const promise = uploadAll(uploads, photos, {
      signal: controller.signal,
      uploadFn: (url, blob, type, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new MuseumApiError('cancelled', 'Upload cancelled.'));
        });
      }),
    });

    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
});
