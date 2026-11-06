import { describe, expect, it } from 'vitest';
import { buildShareUrl, isSharePath, isValidShareId, parseSharePath } from './shareLink.js';

const VALID_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const ORIGIN = 'https://museum.example';

describe('isSharePath', () => {
  it('recognizes /m and every /m/... path', () => {
    expect(isSharePath('/m')).toBe(true);
    expect(isSharePath('/m/')).toBe(true);
    expect(isSharePath(`/m/${VALID_ID}`)).toBe(true);
    expect(isSharePath(`/m/${VALID_ID}/`)).toBe(true);
  });

  it('leaves the creator page and other paths alone', () => {
    expect(isSharePath('/')).toBe(false);
    expect(isSharePath('/museum')).toBe(false);
    expect(isSharePath('/m2/abc')).toBe(false);
    expect(isSharePath('')).toBe(false);
    expect(isSharePath(null)).toBe(false);
  });
});

describe('parseSharePath', () => {
  it('extracts the public id', () => {
    expect(parseSharePath(`/m/${VALID_ID}`)).toBe(VALID_ID);
    expect(parseSharePath(`/m/${VALID_ID}/`)).toBe(VALID_ID);
    expect(parseSharePath(`/m/${VALID_ID}?from=chat`)).toBe(VALID_ID);
  });

  it('decodes percent-encoded segments', () => {
    expect(parseSharePath('/m/abc%2Ddef')).toBe('abc-def');
  });

  it('returns null for missing, extra or malformed segments', () => {
    expect(parseSharePath('/m')).toBeNull();
    expect(parseSharePath('/m/')).toBeNull();
    expect(parseSharePath('/m/id/extra')).toBeNull();
    expect(parseSharePath(`/museum/${VALID_ID}`)).toBeNull();
    expect(parseSharePath('/m/%E0%A4%A')).toBeNull();
    expect(parseSharePath(null)).toBeNull();
  });

  it('does not validate the id alphabet; the caller does', () => {
    expect(parseSharePath('/m/not-a-valid-id')).toBe('not-a-valid-id');
  });
});

describe('isValidShareId', () => {
  it('accepts only 22-character URL-safe ids', () => {
    expect(isValidShareId(VALID_ID)).toBe(true);
    expect(isValidShareId('nope')).toBe(false);
    expect(isValidShareId('a'.repeat(21) + '+')).toBe(false);
    expect(isValidShareId(null)).toBe(false);
  });
});

describe('buildShareUrl', () => {
  it('builds a canonical link and strips a trailing origin slash', () => {
    expect(buildShareUrl(VALID_ID, ORIGIN)).toBe(`${ORIGIN}/m/${VALID_ID}`);
    expect(buildShareUrl(VALID_ID, `${ORIGIN}/`)).toBe(`${ORIGIN}/m/${VALID_ID}`);
  });

  it('refuses to build a link from an invalid id', () => {
    expect(() => buildShareUrl('short', ORIGIN)).toThrow(/invalid museum id/);
    expect(() => buildShareUrl('a'.repeat(21) + '+', ORIGIN)).toThrow(/invalid museum id/);
    expect(() => buildShareUrl(null, ORIGIN)).toThrow(/invalid museum id/);
  });

  it('uses the current origin by default', () => {
    const previous = globalThis.window;
    globalThis.window = { location: { origin: ORIGIN } };
    try {
      expect(buildShareUrl(VALID_ID)).toBe(`${ORIGIN}/m/${VALID_ID}`);
    } finally {
      globalThis.window = previous;
    }
  });
});
