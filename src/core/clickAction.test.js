import { describe, expect, it } from 'vitest';
import { clickAction } from './clickAction.js';

describe('clickAction', () => {
  it('inspects a target even when the pointer is not locked (the post-Esc case)', () => {
    expect(clickAction({ hasTarget: true, locked: false, canLock: true })).toBe('inspect');
  });

  it('inspects while the pointer is already locked', () => {
    expect(clickAction({ hasTarget: true, locked: true, canLock: true })).toBe('inspect');
  });

  it('captures the mouse when there is no target and the pointer is free', () => {
    expect(clickAction({ hasTarget: false, locked: false, canLock: true })).toBe('capture');
  });

  it('does nothing when the pointer is locked and there is no target', () => {
    expect(clickAction({ hasTarget: false, locked: true, canLock: true })).toBe('none');
  });

  it('does not try to capture when Pointer Lock is unavailable', () => {
    expect(clickAction({ hasTarget: false, locked: false, canLock: false })).toBe('none');
  });

  it('falls back to safe defaults', () => {
    expect(clickAction()).toBe('capture');
    expect(clickAction({ hasTarget: false, canLock: false })).toBe('none');
  });
});
