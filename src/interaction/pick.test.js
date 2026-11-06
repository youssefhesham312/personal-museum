import { describe, it, expect } from 'vitest';
import { findInteraction } from './pick.js';

function node(userData = {}, parent = null) {
  return { userData, parent };
}

describe('findInteraction', () => {
  it('finds an interaction on the hit object itself', () => {
    const frame = node({ interact: { type: 'photo', index: 3 } });
    expect(findInteraction(frame)).toEqual({ type: 'photo', index: 3 });
  });

  it('walks up to a parent group', () => {
    const group = node({ interact: { type: 'finale' } });
    const mesh = node({}, node({}, group));
    expect(findInteraction(mesh)).toEqual({ type: 'finale' });
  });

  it('returns null for scenery', () => {
    const mesh = node({}, node({}, node({})));
    expect(findInteraction(mesh)).toBeNull();
  });

  it('ignores malformed interaction data', () => {
    const group = node({ interact: { index: 1 } });
    expect(findInteraction(node({}, group))).toBeNull();
  });

  it('handles a null hit', () => {
    expect(findInteraction(null)).toBeNull();
  });

  it('stops walking a cyclic parent chain', () => {
    const a = node({});
    const b = node({}, a);
    a.parent = b;
    expect(findInteraction(b)).toBeNull();
  });
});
