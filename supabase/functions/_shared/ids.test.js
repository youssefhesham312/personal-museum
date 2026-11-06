import { describe, expect, it } from 'vitest';
import {
  COMPLETION_TOKEN_BYTES,
  PUBLIC_ID_BYTES,
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_PATTERN,
  createCompletionToken,
  createPublicId,
  isPublicId,
  randomToken,
  safeEqual,
  sha256Hex,
} from './ids.js';

describe('createPublicId', () => {
  it('is a 128-bit, URL-safe identifier', () => {
    const id = createPublicId();
    expect(id).toHaveLength(PUBLIC_ID_LENGTH);
    expect(id).toMatch(PUBLIC_ID_PATTERN);
    expect(PUBLIC_ID_BYTES).toBe(16);
  });

  it('does not repeat in a realistic sample', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createPublicId()));
    expect(ids.size).toBe(500);
  });

  it('contains no padding or unsafe characters', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(createPublicId()).not.toMatch(/[+/=]/);
    }
  });
});

describe('randomToken', () => {
  it('produces the expected encoded length for a byte count', () => {
    // 6 bytes -> 8 base64url characters, used for storage path suffixes.
    expect(randomToken(6)).toHaveLength(8);
  });

  it('clamps nonsensical byte counts to at least one byte', () => {
    expect(randomToken(0).length).toBeGreaterThan(0);
    expect(randomToken(-10).length).toBeGreaterThan(0);
  });

  it('creates distinct completion tokens', () => {
    const first = createCompletionToken();
    const second = createCompletionToken();
    expect(first).not.toBe(second);
    expect(first).toHaveLength(Math.ceil((COMPLETION_TOKEN_BYTES * 4) / 3));
  });
});

describe('sha256Hex', () => {
  it('matches a known SHA-256 vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('hashes the string form of its input', async () => {
    expect(await sha256Hex(123)).toBe(await sha256Hex('123'));
  });
});

describe('isPublicId', () => {
  it('accepts only the 22-character URL-safe alphabet', () => {
    expect(isPublicId(createPublicId())).toBe(true);
    expect(isPublicId('a'.repeat(21))).toBe(false);
    expect(isPublicId('a'.repeat(23))).toBe(false);
    expect(isPublicId('a'.repeat(21) + '+')).toBe(false);
    expect(isPublicId('a'.repeat(21) + '/')).toBe(false);
    expect(isPublicId('a'.repeat(21) + '=')).toBe(false);
    expect(isPublicId(null)).toBe(false);
    expect(isPublicId(42)).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal values', () => {
    expect(safeEqual('token', 'token')).toBe(true);
    expect(safeEqual('token', 'tokem')).toBe(false);
    expect(safeEqual('token', 'tokens')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('rejects non-string inputs', () => {
    expect(safeEqual(null, null)).toBe(false);
    expect(safeEqual(undefined, 'x')).toBe(false);
    expect(safeEqual({}, 'x')).toBe(false);
  });
});
