import { describe, expect, it } from 'vitest';
import { MUSEUM_LIMITS } from '../../supabase/functions/_shared/validation.js';
import { validateCreatorDetails } from './creatorValidation.js';

const DETAILS = {
  title: '  Moments for Noor ',
  recipient: ' Noor ',
  dedication: '  A   few words. ',
  finalMessage: ' Thank you.\n\nGoodbye. ',
};

describe('validateCreatorDetails', () => {
  it('accepts a complete museum at the minimum photo count', () => {
    const result = validateCreatorDetails(DETAILS, 5);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.fields).toEqual({});
    expect(result.value).toEqual({
      title: 'Moments for Noor',
      recipient: 'Noor',
      dedication: 'A few words.',
      finalMessage: 'Thank you.\n\nGoodbye.',
    });
  });

  it('accepts the maximum photo count', () => {
    expect(validateCreatorDetails(DETAILS, 15).ok).toBe(true);
  });

  it('requires a title, recipient and closing message', () => {
    const result = validateCreatorDetails({ title: '  ', recipient: '', finalMessage: '' }, 5);

    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.fields).toEqual({
      title: 'Add a museum title.',
      recipient: "Add the recipient's name.",
      finalMessage: 'Add a closing message.',
    });
  });

  it('allows an empty dedication', () => {
    expect(validateCreatorDetails({ ...DETAILS, dedication: '' }, 5).ok).toBe(true);
  });

  it('rejects too few and too many photographs', () => {
    expect(validateCreatorDetails(DETAILS, 4).errors).toEqual([
      `Add at least ${MUSEUM_LIMITS.minPhotos} photographs.`,
    ]);
    expect(validateCreatorDetails(DETAILS, 16).errors).toEqual([
      `A museum can hold at most ${MUSEUM_LIMITS.maxPhotos} photographs.`,
    ]);
  });

  it('treats a missing or non-numeric photo count as zero', () => {
    expect(validateCreatorDetails(DETAILS).errors).toEqual([`Add at least ${MUSEUM_LIMITS.minPhotos} photographs.`]);
    expect(validateCreatorDetails(DETAILS, 'many').errors).toEqual([
      `Add at least ${MUSEUM_LIMITS.minPhotos} photographs.`,
    ]);
  });

  it('normalizes and truncates long fields instead of rejecting them', () => {
    const result = validateCreatorDetails({
      ...DETAILS,
      title: 'x'.repeat(MUSEUM_LIMITS.maxTitleLength + 20),
      dedication: 'y'.repeat(MUSEUM_LIMITS.maxDedicationLength + 20),
      finalMessage: 'z'.repeat(MUSEUM_LIMITS.maxFinalMessageLength + 20),
    }, 5);

    expect(result.ok).toBe(true);
    expect(result.value.title).toHaveLength(MUSEUM_LIMITS.maxTitleLength);
    expect(result.value.dedication).toHaveLength(MUSEUM_LIMITS.maxDedicationLength);
    expect(result.value.finalMessage).toHaveLength(MUSEUM_LIMITS.maxFinalMessageLength);
  });

  it('handles missing and malformed details', () => {
    const result = validateCreatorDetails(undefined, 5);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.fields).sort()).toEqual(['finalMessage', 'recipient', 'title']);

    const malformed = validateCreatorDetails({ title: 42, recipient: null, finalMessage: [] }, 5);
    expect(malformed.ok).toBe(false);
  });

  it('reports field errors and photo errors together', () => {
    const result = validateCreatorDetails({ title: '', recipient: '', finalMessage: '' }, 2);
    expect(result.errors).toHaveLength(1);
    expect(Object.keys(result.fields)).toHaveLength(3);
    expect(result.ok).toBe(false);
  });
});
