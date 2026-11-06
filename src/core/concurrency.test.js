import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('keeps result order', async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value * 5));
      return value * 2;
    });
    expect(result).toEqual([6, 2, 4]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return value;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles empty input', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });

  it('propagates worker failures', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (value) => {
        if (value === 2) throw new Error('boom');
        return value;
      })
    ).rejects.toThrow('boom');
  });
});
