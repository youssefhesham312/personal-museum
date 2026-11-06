import { describe, it, expect } from 'vitest';
import {
  textureTargetSize,
  defaultMaxTextureSize,
  DESKTOP_TEXTURE_LIMIT,
  MOBILE_TEXTURE_LIMIT,
} from './textures.js';

describe('textureTargetSize', () => {
  it('keeps photos that already fit', () => {
    expect(textureTargetSize(1000, 750, 1280)).toEqual({
      width: 1000,
      height: 750,
      resized: false,
    });
  });

  it('scales landscape photos by the long edge', () => {
    const result = textureTargetSize(4000, 3000, 1280);
    expect(result).toEqual({ width: 1280, height: 960, resized: true });
  });

  it('scales portrait photos by the long edge', () => {
    const result = textureTargetSize(2000, 4000, 1024);
    expect(result).toEqual({ width: 512, height: 1024, resized: true });
  });

  it('preserves aspect ratio within a pixel', () => {
    const result = textureTargetSize(3333, 2177, 1024);
    expect(result.width / result.height).toBeCloseTo(3333 / 2177, 2);
  });

  it('never upscales', () => {
    const result = textureTargetSize(400, 300, 1280);
    expect(result.resized).toBe(false);
  });

  it('survives bad dimensions', () => {
    expect(textureTargetSize(0, -4, 1280)).toEqual({
      width: 1,
      height: 1,
      resized: false,
    });
  });
});

describe('defaultMaxTextureSize', () => {
  it('uses the smaller budget for coarse pointers', () => {
    const env = {
      window: {
        matchMedia: () => ({ matches: true }),
        innerWidth: 1440,
        innerHeight: 900,
      },
    };
    expect(defaultMaxTextureSize(env)).toBe(MOBILE_TEXTURE_LIMIT);
  });

  it('uses the smaller budget for small screens', () => {
    const env = {
      window: {
        matchMedia: () => ({ matches: false }),
        innerWidth: 640,
        innerHeight: 900,
      },
    };
    expect(defaultMaxTextureSize(env)).toBe(MOBILE_TEXTURE_LIMIT);
  });

  it('uses the desktop budget for a large mouse-driven screen', () => {
    const env = {
      window: {
        matchMedia: () => ({ matches: false }),
        innerWidth: 1920,
        innerHeight: 1080,
      },
    };
    expect(defaultMaxTextureSize(env)).toBe(DESKTOP_TEXTURE_LIMIT);
  });

  it('falls back to the desktop budget without a window', () => {
    expect(defaultMaxTextureSize({ window: null })).toBe(DESKTOP_TEXTURE_LIMIT);
  });
});
