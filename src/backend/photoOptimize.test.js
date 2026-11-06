import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_UPLOAD_EDGE,
  PhotoOptimisationError,
  computeUploadDimensions,
  optimizePhotoForUpload,
} from './photoOptimize.js';

const originals = {
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
  Image: globalThis.Image,
  document: globalThis.document,
};

afterEach(() => {
  URL.createObjectURL = originals.createObjectURL;
  URL.revokeObjectURL = originals.revokeObjectURL;
  globalThis.Image = originals.Image;
  if (originals.document === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originals.document;
  }
  vi.restoreAllMocks();
});

function stubImage({ width = 800, height = 600, fail = false } = {}) {
  globalThis.Image = class FakeImage {
    constructor() {
      this.naturalWidth = width;
      this.naturalHeight = height;
    }

    set src(value) {
      this._src = value;
      queueMicrotask(() => {
        if (fail) this.onerror?.(new Error('decode failed'));
        else this.onload?.();
      });
    }
  };
}

function stubCanvas(results) {
  const canvases = [];
  const calls = [];

  globalThis.document = {
    createElement(tag) {
      expect(tag).toBe('canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext(type) {
          expect(type).toBe('2d');
          return {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: '',
            drawImage: (...args) => calls.push(args),
          };
        },
        toBlob(callback, type, quality) {
          const result = results.shift();
          queueMicrotask(() => {
            if (result === null) {
              callback(null);
              return;
            }
            const size = result?.size ?? 10;
            const blobType = result?.type ?? type;
            calls.push({ type, quality, size, blobType });
            callback(new Blob([new Uint8Array(size)], { type: blobType }));
          });
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };

  return { canvases, calls };
}

function stubUrls() {
  URL.createObjectURL = vi.fn(() => 'blob:test-image');
  URL.revokeObjectURL = vi.fn();
}

describe('computeUploadDimensions', () => {
  it('keeps small images at their original size', () => {
    expect(computeUploadDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(computeUploadDimensions(MAX_UPLOAD_EDGE, MAX_UPLOAD_EDGE)).toEqual({
      width: MAX_UPLOAD_EDGE,
      height: MAX_UPLOAD_EDGE,
    });
  });

  it('scales the longest edge to the limit without distorting the aspect ratio', () => {
    expect(computeUploadDimensions(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(computeUploadDimensions(1600, 3200)).toEqual({ width: 800, height: 1600 });
    expect(computeUploadDimensions(4000, 1000)).toEqual({ width: 1600, height: 400 });
    expect(computeUploadDimensions(1, 10000)).toEqual({ width: 1, height: 1600 });
  });

  it('rounds to whole pixels and never returns zero', () => {
    expect(computeUploadDimensions(1001, 1001, 100)).toEqual({ width: 100, height: 100 });
    expect(computeUploadDimensions(1, 10000, 100)).toEqual({ width: 1, height: 100 });
  });

  it('honours a custom edge and rejects bad configuration', () => {
    expect(computeUploadDimensions(3000, 1000, 500)).toEqual({ width: 500, height: 167 });
    expect(() => computeUploadDimensions(100, 100, 0)).toThrow(PhotoOptimisationError);
    expect(() => computeUploadDimensions(100, 100, 'wide')).toThrow(/size configuration/);
  });

  it('rejects invalid image dimensions', () => {
    for (const [width, height] of [
      [0, 100],
      [100, 0],
      [-1, 100],
      ['wide', 100],
      [NaN, 100],
      [Infinity, 100],
    ]) {
      expect(() => computeUploadDimensions(width, height)).toThrow(PhotoOptimisationError);
    }
  });
});

describe('optimizePhotoForUpload', () => {
  it('returns a small, supported file unchanged', async () => {
    stubUrls();
    stubImage({ width: 800, height: 600 });
    const file = new Blob(['small'], { type: 'image/jpeg' });

    const result = await optimizePhotoForUpload(file);

    expect(result.blob).toBe(file);
    expect(result).toEqual({
      blob: file,
      width: 800,
      height: 600,
      contentType: 'image/jpeg',
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
    expect(globalThis.document).toBe(originals.document);
  });

  it('re-encodes a large image to WebP at the target dimensions', async () => {
    stubUrls();
    stubImage({ width: 3200, height: 1600 });
    const { canvases, calls } = stubCanvas([{ size: 100, type: 'image/webp' }]);

    const result = await optimizePhotoForUpload(
      new Blob(['large'], { type: 'image/jpeg' }),
      { maxBytes: 1_000 }
    );

    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
    expect(result.contentType).toBe('image/webp');
    expect(canvases[0]).toMatchObject({ width: 1600, height: 800 });
    expect(calls[0].slice(1, 4)).toEqual([0, 0, 1600]);
    expect(calls[0][4]).toBe(800);
    expect(calls.find((call) => call.type)).toMatchObject({
      type: 'image/webp',
      quality: 0.82,
    });
  });

  it('falls back to JPEG when the browser cannot encode WebP', async () => {
    stubUrls();
    stubImage({ width: 2000, height: 1000 });
    stubCanvas([
      { size: 20, type: 'image/png' },
      { size: 5, type: 'image/jpeg' },
    ]);

    const result = await optimizePhotoForUpload(
      new Blob(['large'], { type: 'image/jpeg' }),
      { maxBytes: 10 }
    );

    expect(result.contentType).toBe('image/jpeg');
    expect(result.blob.size).toBe(5);
  });

  it('shrinks the pixels after repeated quality reductions', async () => {
    stubUrls();
    stubImage({ width: 1600, height: 800 });
    const { canvases } = stubCanvas([
      { size: 100, type: 'image/webp' },
      { size: 90, type: 'image/webp' },
      { size: 80, type: 'image/webp' },
      { size: 5, type: 'image/webp' },
    ]);

    const result = await optimizePhotoForUpload(
      new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
      { maxBytes: 10 }
    );

    expect(result.width).toBeLessThan(1600);
    expect(result.height).toBeLessThan(800);
    expect(canvases).toHaveLength(4);
    expect(canvases[3].width).toBe(result.width);
  });

  it('fails clearly when the image cannot be compressed enough', async () => {
    stubUrls();
    stubImage({ width: 1600, height: 800 });
    stubCanvas(Array.from({ length: 5 }, () => ({ size: 100, type: 'image/webp' })));

    await expect(optimizePhotoForUpload(
      new Blob([new Uint8Array(100)], { type: 'image/jpeg' }),
      { maxBytes: 10 }
    )).rejects.toThrow(/could not be compressed enough/);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('fails when the browser cannot read the image', async () => {
    stubUrls();
    stubImage({ fail: true });

    await expect(optimizePhotoForUpload(new Blob(['x'], { type: 'image/jpeg' })))
      .rejects.toThrow('This photograph could not be read by this browser.');
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('fails when the browser reports invalid dimensions', async () => {
    stubUrls();
    stubImage({ width: 0, height: 0 });

    await expect(optimizePhotoForUpload(new Blob(['x'], { type: 'image/jpeg' })))
      .rejects.toThrow('This photograph has invalid dimensions.');
  });

  it('fails when a canvas context is unavailable', async () => {
    stubUrls();
    stubImage({ width: 3200, height: 1600 });
    globalThis.document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => null,
      }),
    };

    await expect(optimizePhotoForUpload(new Blob(['x'], { type: 'image/jpeg' })))
      .rejects.toThrow('This browser cannot prepare photographs for sharing.');
  });

  it('fails when the canvas cannot encode a blob', async () => {
    stubUrls();
    stubImage({ width: 3200, height: 1600 });
    stubCanvas([null]);

    await expect(optimizePhotoForUpload(new Blob(['x'], { type: 'image/jpeg' })))
      .rejects.toThrow('This photograph could not be prepared for sharing.');
  });

  it('rejects inputs that are not files', async () => {
    await expect(optimizePhotoForUpload('photo.jpg'))
      .rejects.toThrow('This photograph could not be read.');
    await expect(optimizePhotoForUpload(null))
      .rejects.toThrow(PhotoOptimisationError);
  });
});
