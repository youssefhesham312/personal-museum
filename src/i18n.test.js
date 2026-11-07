import { describe, expect, it, afterEach } from 'vitest';
import {
  _dictionaryKeys,
  _resetLanguage,
  getLanguage,
  isRTL,
  setLanguage,
  t,
} from './i18n.js';

afterEach(() => {
  _resetLanguage();
});

describe('i18n', () => {
  it('defaults to English', () => {
    expect(getLanguage()).toBe('en');
    expect(t('creator.addPhotos')).toBe('Add Photos');
    expect(isRTL()).toBe(false);
  });

  it('switches to Arabic and back', () => {
    setLanguage('ar');
    expect(getLanguage()).toBe('ar');
    expect(isRTL()).toBe(true);
    expect(t('creator.addPhotos')).toBe('إضافة صور');
    expect(t('app.title')).toBe('المتحف الشخصي');

    setLanguage('en');
    expect(t('creator.addPhotos')).toBe('Add Photos');
  });

  it('interpolates parameters', () => {
    expect(t('creator.photoCount', { count: 3, max: 15 })).toBe('3 of 15 photos added');
    setLanguage('ar');
    expect(t('creator.photoCount', { count: 3, max: 15 })).toBe('3 من 15 صورة مضافة');
  });

  it('falls back to the key when a translation is missing', () => {
    expect(t('missing.translation.key')).toBe('missing.translation.key');
  });

  it('has the same keys in both dictionaries', () => {
    const keys = _dictionaryKeys();
    expect(keys.ar).toEqual(keys.en);
  });
});
