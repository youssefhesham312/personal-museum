import { describe, expect, it } from 'vitest';
import {
  buildUploadSummary,
  looksLikeHeic,
  partitionByPhotoLimit,
  uploadFailureReason,
} from './upload.js';

describe('looksLikeHeic', () => {
  it('recognises HEIC by type and by extension', () => {
    expect(looksLikeHeic({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(looksLikeHeic({ type: '', name: 'IMG_0002.heif' })).toBe(true);
  });

  it('leaves ordinary photos alone', () => {
    expect(looksLikeHeic({ type: 'image/jpeg', name: 'holiday.jpg' })).toBe(false);
    expect(looksLikeHeic({ type: 'image/png', name: 'scan.png' })).toBe(false);
    expect(looksLikeHeic(null)).toBe(false);
  });
});

describe('uploadFailureReason', () => {
  it('names HEIC instead of blaming the file', () => {
    expect(uploadFailureReason({ type: 'image/heic', name: 'a.heic' }, new Error('x')))
      .toBe('HEIC photos are not supported by this browser');
  });

  it('distinguishes a full quota from an unreadable file', () => {
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    expect(uploadFailureReason({ type: 'image/jpeg', name: 'a.jpg' }, quota))
      .toBe('browser storage is full');
    expect(uploadFailureReason({ type: 'image/heic', name: 'a.heic' }, quota))
      .toBe('browser storage is full');
    expect(uploadFailureReason({ type: 'image/jpeg', name: 'a.jpg' }, new Error('bad')))
      .toBe('the file could not be read as an image');
  });
});

describe('buildUploadSummary', () => {
  it('reports a clean batch', () => {
    expect(buildUploadSummary({ added: 3, failed: [] })).toEqual({
      text: '3 photos added.',
      tone: 'ok',
    });
    expect(buildUploadSummary({ added: 1, failed: [] }).text).toBe('1 photo added.');
  });

  it('keeps the saved photos when part of the batch fails', () => {
    const summary = buildUploadSummary({
      added: 4,
      failed: [{ name: 'IMG_1.HEIC', reason: 'HEIC photos are not supported by this browser' }],
    });

    expect(summary.tone).toBe('warn');
    expect(summary.text).toContain('4 added');
    expect(summary.text).toContain('IMG_1.HEIC');
    expect(summary.text).toContain('exported as JPEG');
  });

  it('explains a batch where nothing could be read', () => {
    const summary = buildUploadSummary({
      added: 0,
      failed: [
        { name: 'a.jpg', reason: 'the file could not be read as an image' },
        { name: 'b.jpg', reason: 'the file could not be read as an image' },
        { name: 'c.jpg', reason: 'the file could not be read as an image' },
      ],
    });

    expect(summary.tone).toBe('error');
    expect(summary.text).toContain('Nothing was added');
    expect(summary.text).toContain('and 1 more');
  });

  it('reports photos skipped by the 15-photo limit', () => {
    const summary = buildUploadSummary({ added: 2, failed: [], limitSkipped: 3 });

    expect(summary.tone).toBe('warn');
    expect(summary.text).toContain('2 photos added.');
    expect(summary.text).toContain('Only 15 photos fit in a museum; 3 were not added.');
  });

  it('recognizes HEIC from the wrapped failure entry', () => {
    const summary = buildUploadSummary({
      added: 0,
      failed: [
        {
          name: 'IMG_1',
          reason: 'the file could not be read as an image',
          file: { type: 'image/heic', name: 'IMG_1' },
        },
      ],
    });

    expect(summary.text).toContain('exported as JPEG');
  });
});

describe('partitionByPhotoLimit', () => {
  const files = Array.from({ length: 6 }, (_, index) => ({ name: `${index}.jpg` }));

  it('accepts only the files that still fit', () => {
    const result = partitionByPhotoLimit(files, 12, 15);
    expect(result.accepted.map((file) => file.name)).toEqual(['0.jpg', '1.jpg', '2.jpg']);
    expect(result.skipped.map((file) => file.name)).toEqual(['3.jpg', '4.jpg', '5.jpg']);
    expect(result.remaining).toBe(3);
  });

  it('accepts everything when the museum is empty', () => {
    const result = partitionByPhotoLimit(files, 0, 15);
    expect(result.accepted).toHaveLength(6);
    expect(result.skipped).toHaveLength(0);
    expect(result.remaining).toBe(15);
  });

  it('accepts nothing when the museum is already full', () => {
    const result = partitionByPhotoLimit(files, 15, 15);
    expect(result.accepted).toHaveLength(0);
    expect(result.skipped).toHaveLength(6);
    expect(result.remaining).toBe(0);
  });

  it('handles a stale count above the limit and malformed input', () => {
    const over = partitionByPhotoLimit(files, 99, 15);
    expect(over.accepted).toHaveLength(0);
    expect(over.remaining).toBe(0);

    const empty = partitionByPhotoLimit(null, 0, 15);
    expect(empty).toEqual({ accepted: [], skipped: [], remaining: 15 });
  });
});
