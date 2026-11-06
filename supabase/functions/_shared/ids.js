/**
 * Unpredictable identifiers and hashing helpers.
 *
 * `crypto.getRandomValues` is available in browsers, Node and Deno, so this
 * module can be tested without a Supabase project.
 */

export const PUBLIC_ID_BYTES = 16; // 128 bits -> 22 base64url characters
export const PUBLIC_ID_LENGTH = 22;
export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const COMPLETION_TOKEN_BYTES = 32;

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomToken(byteLength = PUBLIC_ID_BYTES) {
  const length = Math.max(1, Math.trunc(byteLength));
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** A public, shareable museum id. 128 bits of cryptographic randomness. */
export function createPublicId() {
  return randomToken(PUBLIC_ID_BYTES);
}

/**
 * A one-time creator capability. It is returned once, stored only as a
 * SHA-256 hash, and required to finish or abort a draft.
 */
export function createCompletionToken() {
  return randomToken(COMPLETION_TOKEN_BYTES);
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function isPublicId(value) {
  return typeof value === 'string' && PUBLIC_ID_PATTERN.test(value);
}

/** Constant-time-ish comparison for two short secrets/tokens. */
export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
