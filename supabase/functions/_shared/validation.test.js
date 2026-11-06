import { describe, expect, it } from 'vitest';
import {
  MUSEUM_LIMITS,
  cleanBlock,
  cleanLine,
  validateMuseumInput,
} from './validation.js';

function photo(overrides = {}) {
  return {
    contentType: 'image/jpeg',
    byteSize: 200_000,
    width: 1600,
    height: 1200,
    caption: 'A day at the sea',
    dateLabel: 'Summer 2019',
    ...overrides,
  };
}

function museum(overrides = {}) {
  return {
    title: 'Moments for Noor',
    recipient: 'Noor',
    dedication: 'For the years we keep.',
    finalMessage: 'Thank you for walking through this.',
    photos: Array.from({ length: 5 }, (_, index) =>
      photo({ caption: `Photo ${index + 1}` })
    ),
    ...overrides,
  };
}

describe('cleanLine', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanLine('  A   small\n\tmuseum  ', 100)).toBe('A small museum');
  });

  it('enforces the maximum length and rejects non-strings', () => {
    expect(cleanLine('abcdef', 3)).toBe('abc');
    expect(cleanLine(null, 10)).toBe('');
    expect(cleanLine(42, 10)).toBe('');
  });
});

describe('cleanBlock', () => {
  it('keeps paragraph breaks but tidies each line', () => {
    expect(cleanBlock('  First   line \r\n\r\n\r\n Second\tline  ', 200))
      .toBe('First line\n\nSecond line');
  });

  it('truncates and tolerates non-strings', () => {
    expect(cleanBlock('abcdef', 4)).toBe('abcd');
    expect(cleanBlock(undefined, 10)).toBe('');
  });
});

describe('validateMuseumInput', () => {
  it('accepts and normalizes a complete museum', () => {
    const result = validateMuseumInput(museum());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.fields).toEqual({});
    expect(result.value.title).toBe('Moments for Noor');
    expect(result.value.recipient).toBe('Noor');
    expect(result.value.photos).toHaveLength(5);
    expect(result.value.photos[0]).toMatchObject({
      position: 0,
      contentType: 'image/jpeg',
      byteSize: 200_000,
      width: 1600,
      height: 1200,
      caption: 'Photo 1',
      dateLabel: 'Summer 2019',
    });
  });

  it('accepts the five and fifteen photo boundaries', () => {
    expect(validateMuseumInput(museum({ photos: Array.from({ length: 5 }, () => photo()) })).ok)
      .toBe(true);
    expect(validateMuseumInput(museum({ photos: Array.from({ length: 15 }, () => photo({ byteSize: 100_000 })) })).ok)
      .toBe(true);
  });

  it('rejects fewer than five and more than fifteen photos', () => {
    expect(validateMuseumInput(museum({ photos: Array.from({ length: 4 }, () => photo()) })).errors)
      .toContain('Add between 5 and 15 photos.');
    expect(validateMuseumInput(museum({ photos: Array.from({ length: 16 }, () => photo({ byteSize: 10_000 })) })).errors)
      .toContain('Add between 5 and 15 photos.');
  });

  it('requires a title, recipient and closing message', () => {
    const result = validateMuseumInput(museum({
      title: '   ',
      recipient: '',
      finalMessage: '\n\n',
    }));

    expect(result.ok).toBe(false);
    expect(result.fields).toEqual({
      title: 'A museum title is required.',
      recipient: "The recipient's name is required.",
      finalMessage: 'A closing message is required.',
    });
  });

  it('allows an empty dedication', () => {
    const result = validateMuseumInput(museum({ dedication: '' }));
    expect(result.ok).toBe(true);
    expect(result.value.dedication).toBe('');
  });

  it('rejects unsupported photo types', () => {
    const result = validateMuseumInput(museum({
      photos: [photo({ contentType: 'image/gif' }), ...Array.from({ length: 4 }, () => photo())],
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Photo 1 must be a JPEG, PNG or WebP image.');
  });

  it('rejects empty, oversized and non-integer byte sizes', () => {
    const result = validateMuseumInput(museum({
      photos: [
        photo({ byteSize: 0 }),
        photo({ byteSize: MUSEUM_LIMITS.maxPhotoBytes + 1 }),
        photo({ byteSize: 12.5 }),
        ...Array.from({ length: 3 }, () => photo()),
      ],
    }));

    expect(result.errors.filter((error) => error.includes('must be smaller'))).toHaveLength(3);
  });

  it('rejects invalid dimensions and dimensions beyond the limit', () => {
    const result = validateMuseumInput(museum({
      photos: [
        photo({ width: 0 }),
        photo({ height: -1 }),
        photo({ width: MUSEUM_LIMITS.maxDimension + 1 }),
        ...Array.from({ length: 3 }, () => photo()),
      ],
    }));

    expect(result.errors.filter((error) => error.includes('invalid size'))).toHaveLength(3);
  });

  it('rejects a total payload above the aggregate limit', () => {
    const result = validateMuseumInput(museum({
      photos: Array.from({ length: 11 }, () => photo({ byteSize: MUSEUM_LIMITS.maxPhotoBytes })),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      `The photographs total more than ${Math.round(MUSEUM_LIMITS.maxTotalPhotoBytes / (1024 * 1024))} MB.`
    );
  });

  it('ignores client-supplied positions, paths and timestamps', () => {
    const result = validateMuseumInput(museum({
      photos: Array.from({ length: 5 }, (_, index) => photo({
        position: index + 9,
        storage_path: 'somewhere/else.jpg',
        id: 'chosen',
      })),
    }));

    expect(result.ok).toBe(true);
    expect(result.value.photos.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4]);
    expect(result.value.photos[0]).not.toHaveProperty('storage_path');
    expect(result.value.photos[0]).not.toHaveProperty('id');
  });

  it('accepts the size and date aliases used by older clients', () => {
    const result = validateMuseumInput(museum({
      photos: Array.from({ length: 5 }, () => ({
        contentType: 'image/webp',
        size: 1000,
        width: 800,
        height: 600,
        date: ' 1999 ',
      })),
    }));

    expect(result.ok).toBe(true);
    expect(result.value.photos[0]).toMatchObject({
      byteSize: 1000,
      dateLabel: '1999',
      contentType: 'image/webp',
    });
  });

  it('truncates long text instead of rejecting it', () => {
    const result = validateMuseumInput(museum({
      title: 'x'.repeat(MUSEUM_LIMITS.maxTitleLength + 50),
      dedication: 'y'.repeat(MUSEUM_LIMITS.maxDedicationLength + 50),
      finalMessage: 'z'.repeat(MUSEUM_LIMITS.maxFinalMessageLength + 50),
    }));

    expect(result.ok).toBe(true);
    expect(result.value.title).toHaveLength(MUSEUM_LIMITS.maxTitleLength);
    expect(result.value.dedication).toHaveLength(MUSEUM_LIMITS.maxDedicationLength);
    expect(result.value.finalMessage).toHaveLength(MUSEUM_LIMITS.maxFinalMessageLength);
  });

  it('rejects non-object bodies', () => {
    for (const input of [null, undefined, 'museum', 42, []]) {
      const result = validateMuseumInput(input);
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual(['The request body must be a JSON object.']);
      expect(result.value).toBeNull();
    }
  });

  it('reports a missing photo object without crashing', () => {
    const result = validateMuseumInput(museum({
      photos: [null, ...Array.from({ length: 4 }, () => photo())],
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Photo 1 is missing its metadata.');
  });

  it('uses an injected limits object for boundary tests', () => {
    const limits = { ...MUSEUM_LIMITS, minPhotos: 1, maxPhotos: 2 };
    const result = validateMuseumInput(museum({ photos: [photo()] }), limits);
    expect(result.ok).toBe(true);
  });
});
