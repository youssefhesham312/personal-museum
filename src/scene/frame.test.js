import { describe, expect, it } from 'vitest';
import { BufferGeometry, PlaneGeometry } from 'three';
import { createFrame, flipVerticalUvs } from './frame.js';

describe('flipVerticalUvs', () => {
  it('turns the top-left UV into the bottom-left UV', () => {
    const geometry = new PlaneGeometry(1, 1);
    const uv = geometry.getAttribute('uv');
    expect(uv.getY(0)).toBe(1);

    flipVerticalUvs(geometry);

    expect(uv.getY(0)).toBe(0);
    expect(uv.getY(uv.count - 1)).toBe(1);
  });

  it('leaves a geometry without UVs alone', () => {
    const geometry = new BufferGeometry();
    expect(flipVerticalUvs(geometry)).toBe(geometry);
    expect(() => flipVerticalUvs(null)).not.toThrow();
  });
});

describe('createFrame', () => {
  it('sizes a portrait photo as a portrait frame and flips its photo UVs', () => {
    const frame = createFrame({ texture: null, photoWidth: 600, photoHeight: 1200 });
    const photo = frame.children.find((child) => child.name === 'frame-photo');

    expect(photo).toBeTruthy();
    expect(photo.geometry.parameters.height).toBeGreaterThan(photo.geometry.parameters.width);

    const uv = photo.geometry.getAttribute('uv');
    expect(uv.getY(0)).toBe(0);
    expect(uv.getY(uv.count - 1)).toBe(1);
  });

  it('keeps a landscape photo landscape', () => {
    const frame = createFrame({ texture: null, photoWidth: 1600, photoHeight: 900 });
    const photo = frame.children.find((child) => child.name === 'frame-photo');

    expect(photo.geometry.parameters.width).toBeGreaterThan(photo.geometry.parameters.height);
  });
});
