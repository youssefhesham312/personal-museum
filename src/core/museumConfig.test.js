import { describe, it, expect } from 'vitest';
import { normalizeMuseumConfig, isBuildableConfig } from './museumConfig.js';

describe('normalizeMuseumConfig', () => {
  it('returns safe defaults for an empty config', () => {
    const config = normalizeMuseumConfig();
    expect(config.title).toBe('Personal Museum');
    expect(config.recipient).toBe('');
    expect(config.dedication).toBe('');
    expect(config.finalMessage).toBe('');
    expect(config.photos).toEqual([]);
  });

  it('collapses whitespace in single-line fields', () => {
    const config = normalizeMuseumConfig({
      title: '  Our   Little   Museum ',
      recipient: ' Noor  ',
    });
    expect(config.title).toBe('Our Little Museum');
    expect(config.recipient).toBe('Noor');
  });

  it('preserves paragraphs but tidies lines in multi-line fields', () => {
    const config = normalizeMuseumConfig({
      finalMessage: '  First line  \n\n\n  Second   line\n',
    });
    expect(config.finalMessage).toBe('First line\n\nSecond line');
  });

  it('keeps photo order and normalizes metadata', () => {
    const config = normalizeMuseumConfig({
      photos: [
        { url: '/a.jpg', width: 800, height: 600, caption: '  First  ', date: '2020' },
        { url: '/b.jpg' },
      ],
    });

    expect(config.photos).toHaveLength(2);
    expect(config.photos[0]).toMatchObject({
      url: '/a.jpg',
      width: 800,
      height: 600,
      caption: 'First',
      date: '2020',
    });
    expect(config.photos[1].width).toBe(1600);
    expect(config.photos[1].height).toBe(1200);
    expect(config.photos[1].id).toBe('photo-2');
  });

  it('drops photos without a usable url', () => {
    const config = normalizeMuseumConfig({
      photos: [{ caption: 'no url' }, null, { url: '   ' }, { url: '/ok.jpg' }],
    });
    expect(config.photos).toHaveLength(1);
    expect(config.photos[0].url).toBe('/ok.jpg');
  });

  it('rejects non-finite and negative dimensions', () => {
    const config = normalizeMuseumConfig({
      photos: [{ url: '/a.jpg', width: -5, height: 'nope' }],
    });
    expect(config.photos[0].width).toBe(1600);
    expect(config.photos[0].height).toBe(1200);
  });

  it('truncates very long text', () => {
    const config = normalizeMuseumConfig({ finalMessage: 'x'.repeat(9000) });
    expect(config.finalMessage.length).toBeLessThanOrEqual(4000);
  });
});

describe('isBuildableConfig', () => {
  it('requires at least one photo', () => {
    expect(isBuildableConfig(normalizeMuseumConfig())).toBe(false);
    expect(
      isBuildableConfig(normalizeMuseumConfig({ photos: [{ url: '/a.jpg' }] }))
    ).toBe(true);
  });
});
