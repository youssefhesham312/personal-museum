import { describe, expect, it } from 'vitest';
import {
  DRAFT_GRACE_MS,
  RETENTION_DAYS,
  RETENTION_MS,
  expiresAtFrom,
  isDraftAbandoned,
  isExpired,
  isPubliclyReadable,
  sortPhotos,
} from './museumRules.js';

const CREATED = new Date('2026-10-01T12:00:00.000Z');

describe('expiresAtFrom', () => {
  it('adds exactly seven days to the server creation time', () => {
    expect(RETENTION_DAYS).toBe(7);
    expect(RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(expiresAtFrom(CREATED).toISOString()).toBe('2026-10-08T12:00:00.000Z');
    expect(expiresAtFrom(CREATED.toISOString()).toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('returns null for an unparseable creation time', () => {
    expect(expiresAtFrom('not a date')).toBeNull();
    expect(expiresAtFrom(null)).toBeNull();
  });
});

describe('isExpired', () => {
  it('expires at the exact boundary, not a moment after it', () => {
    const expiry = '2026-10-08T12:00:00.000Z';
    expect(isExpired(expiry, new Date('2026-10-08T11:59:59.999Z'))).toBe(false);
    expect(isExpired(expiry, new Date('2026-10-08T12:00:00.000Z'))).toBe(true);
    expect(isExpired(expiry, new Date('2026-10-08T12:00:00.001Z'))).toBe(true);
  });

  it('fails closed for invalid timestamps', () => {
    expect(isExpired('nonsense')).toBe(true);
    expect(isExpired(null)).toBe(true);
    expect(isExpired('2026-10-08T12:00:00.000Z', 'nonsense')).toBe(true);
  });
});

describe('isPubliclyReadable', () => {
  it('requires a finalized museum', () => {
    expect(isPubliclyReadable({ ready_at: null, expires_at: '2026-10-08T12:00:00.000Z' }, CREATED))
      .toBe(false);
    expect(isPubliclyReadable(null, CREATED)).toBe(false);
    expect(isPubliclyReadable({}, CREATED)).toBe(false);
  });

  it('is readable after finalize and before expiry', () => {
    expect(isPubliclyReadable(
      { ready_at: '2026-10-01T12:01:00.000Z', expires_at: '2026-10-08T12:00:00.000Z' },
      CREATED
    )).toBe(true);
  });

  it('stops being readable at expiry even before cleanup runs', () => {
    const museum = {
      ready_at: '2026-10-01T12:01:00.000Z',
      expires_at: '2026-10-08T12:00:00.000Z',
    };
    expect(isPubliclyReadable(museum, new Date('2026-10-08T12:00:00.000Z'))).toBe(false);
  });
});

describe('isDraftAbandoned', () => {
  it('only applies to unfinished museums', () => {
    expect(isDraftAbandoned({ ready_at: '2026-10-01T12:01:00.000Z', created_at: CREATED }, CREATED)).toBe(false);
  });

  it('waits for the upload grace period', () => {
    const draft = { ready_at: null, created_at: CREATED };
    expect(isDraftAbandoned(draft, new Date(CREATED.getTime() + DRAFT_GRACE_MS - 1))).toBe(false);
    expect(isDraftAbandoned(draft, new Date(CREATED.getTime() + DRAFT_GRACE_MS))).toBe(true);
  });

  it('accepts a custom grace period and invalid rows fail closed', () => {
    const draft = { ready_at: null, created_at: CREATED };
    expect(isDraftAbandoned(draft, new Date(CREATED.getTime() + 5000), 1000)).toBe(true);
    expect(isDraftAbandoned({ ready_at: null, created_at: 'bad' }, CREATED)).toBe(false);
    expect(isDraftAbandoned(null, CREATED)).toBe(false);
  });
});

describe('sortPhotos', () => {
  it('orders photos by their server-assigned position', () => {
    const photos = [{ position: 2, id: 'c' }, { position: 0, id: 'a' }, { position: 1, id: 'b' }];
    expect(sortPhotos(photos).map((photo) => photo.id)).toEqual(['a', 'b', 'c']);
    expect(photos.map((photo) => photo.id)).toEqual(['c', 'a', 'b']);
  });

  it('tolerates missing and malformed input', () => {
    expect(sortPhotos(null)).toEqual([]);
    expect(sortPhotos('photos')).toEqual([]);
    expect(sortPhotos([{ position: null }, { position: 1 }])).toHaveLength(2);
  });
});
