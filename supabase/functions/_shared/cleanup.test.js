import { describe, expect, it, vi } from 'vitest';
import { runMuseumCleanup } from './cleanup.js';

const NOW = new Date('2026-10-26T12:00:00.000Z');

function makeStore(overrides = {}) {
  const calls = [];

  const store = {
    listExpired: vi.fn(async () => []),
    listAbandoned: vi.fn(async () => []),
    listObjectPaths: vi.fn(async () => []),
    removeObjects: vi.fn(async () => {
      calls.push('removeObjects');
    }),
    deleteMuseum: vi.fn(async () => {
      calls.push('deleteMuseum');
    }),
    ...overrides,
  };

  return { store, calls };
}

describe('runMuseumCleanup', () => {
  it('returns a zeroed summary for an empty queue', async () => {
    const { store } = makeStore();
    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary).toEqual({
      scanned: 0,
      deleted: 0,
      failed: 0,
      objectsRemoved: 0,
      errors: [],
    });
    expect(store.listExpired).toHaveBeenCalledWith(NOW.toISOString(), 25);
    expect(store.listAbandoned).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
      25
    );
  });

  it('removes storage objects before deleting the database row', async () => {
    const order = [];
    const { store } = makeStore({
      listExpired: async () => [{ id: 'museum-1' }],
      listObjectPaths: async () => ['museums/museum-1/00-a.jpg', 'museums/museum-1/01-b.jpg'],
      removeObjects: async () => {
        order.push('storage');
      },
      deleteMuseum: async () => {
        order.push('database');
      },
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(order).toEqual(['storage', 'database']);
    expect(summary).toMatchObject({ scanned: 1, deleted: 1, failed: 0, objectsRemoved: 2 });
  });

  it('deletes rows even when they have no storage objects', async () => {
    const { store } = makeStore({
      listExpired: async () => [{ id: 'museum-1' }],
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(store.removeObjects).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ deleted: 1, objectsRemoved: 0 });
  });

  it('merges and deduplicates expired and abandoned museums', async () => {
    const { store } = makeStore({
      listExpired: async () => [{ id: 'same' }, { id: 'expired' }],
      listAbandoned: async () => [{ id: 'same' }, { id: 'draft' }],
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary.scanned).toBe(3);
    expect(store.deleteMuseum).toHaveBeenCalledTimes(3);
    expect(store.deleteMuseum.mock.calls.map(([id]) => id).sort()).toEqual([
      'draft',
      'expired',
      'same',
    ]);
  });

  it('retries a failed row delete on the next run without failing on missing objects', async () => {
    let rowExists = true;
    let objectsExist = true;
    let deleteAttempts = 0;

    const { store } = makeStore({
      listExpired: async () => (rowExists ? [{ id: 'museum-1' }] : []),
      listObjectPaths: async () => (objectsExist ? ['museums/museum-1/00-a.jpg'] : []),
      removeObjects: async () => {
        objectsExist = false;
      },
      deleteMuseum: async () => {
        deleteAttempts += 1;
        if (deleteAttempts === 1) throw new Error('temporary database failure');
        rowExists = false;
      },
    });

    const first = await runMuseumCleanup(store, { now: NOW });
    expect(first).toMatchObject({ deleted: 0, failed: 1, objectsRemoved: 1 });
    expect(first.errors[0].stage).toBe('delete');
    expect(rowExists).toBe(true);

    const second = await runMuseumCleanup(store, { now: NOW });
    expect(second).toMatchObject({ scanned: 1, deleted: 1, failed: 0, objectsRemoved: 0 });
  });

  it('keeps the row when storage deletion fails, so the next run can retry', async () => {
    let storageFails = true;

    const { store } = makeStore({
      listExpired: async () => [{ id: 'museum-1' }],
      listObjectPaths: async () => ['museums/museum-1/00-a.jpg'],
      removeObjects: async () => {
        if (storageFails) throw new Error('storage unavailable');
      },
    });

    const first = await runMuseumCleanup(store, { now: NOW });
    expect(first).toMatchObject({ deleted: 0, failed: 1 });
    expect(store.deleteMuseum).not.toHaveBeenCalled();

    storageFails = false;
    const second = await runMuseumCleanup(store, { now: NOW });
    expect(second).toMatchObject({ deleted: 1, failed: 0, objectsRemoved: 1 });
  });

  it('retries only the remaining R2 objects after a partial delete', async () => {
    const objects = new Set([
      'museums/museum-1/00-a.jpg',
      'museums/museum-1/01-b.jpg',
    ]);
    let rowExists = true;
    let failSecondDelete = true;

    const { store } = makeStore({
      listExpired: async () => (rowExists ? [{ id: 'museum-1' }] : []),
      listObjectPaths: async () => [...objects],
      removeObjects: async (paths) => {
        for (const path of paths) {
          if (failSecondDelete && path.endsWith('01-b.jpg')) {
            throw new Error('R2 temporarily unavailable');
          }
          objects.delete(path);
        }
      },
      deleteMuseum: async () => {
        rowExists = false;
      },
    });

    const first = await runMuseumCleanup(store, { now: NOW });
    expect(first).toMatchObject({ deleted: 0, failed: 1 });
    expect(rowExists).toBe(true);
    expect([...objects]).toEqual(['museums/museum-1/01-b.jpg']);

    failSecondDelete = false;
    const second = await runMuseumCleanup(store, { now: NOW });
    expect(second).toMatchObject({ deleted: 1, failed: 0, objectsRemoved: 1 });
    expect(rowExists).toBe(false);
    expect(objects.size).toBe(0);
  });

  it('keeps the row when R2 object listing fails', async () => {
    const { store } = makeStore({
      listExpired: async () => [{ id: 'museum-1' }],
      listObjectPaths: async () => {
        throw new Error('R2 list failed');
      },
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary).toMatchObject({ deleted: 0, failed: 1 });
    expect(summary.errors[0]).toMatchObject({ museumId: 'museum-1', stage: 'delete' });
    expect(store.removeObjects).not.toHaveBeenCalled();
    expect(store.deleteMuseum).not.toHaveBeenCalled();
  });

  it('continues with other museums after one failure', async () => {
    const { store } = makeStore({
      listExpired: async () => [{ id: 'bad' }, { id: 'good' }],
      deleteMuseum: async (id) => {
        if (id === 'bad') throw new Error('row locked');
      },
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary).toMatchObject({ scanned: 2, deleted: 1, failed: 1 });
    expect(summary.errors[0]).toMatchObject({ museumId: 'bad', stage: 'delete' });
  });

  it('reports listing failures but still processes the other list', async () => {
    const { store } = makeStore({
      listExpired: async () => {
        throw new Error('query failed');
      },
      listAbandoned: async () => [{ id: 'draft' }],
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary).toMatchObject({ scanned: 1, deleted: 1, failed: 1 });
    expect(summary.errors[0]).toMatchObject({ museumId: null, stage: 'list_expired' });
  });

  it('sanitizes error messages and truncates them', async () => {
    const { store } = makeStore({
      listExpired: async () => [{ id: 'museum-1' }],
      listObjectPaths: async () => {
        throw new Error(`failed at https://secret.example/path ${'x'.repeat(500)}`);
      },
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary.errors[0].message).not.toContain('https://');
    expect(summary.errors[0].message).toContain('[url]');
    expect(summary.errors[0].message.length).toBeLessThanOrEqual(240);
  });

  it('clamps the batch size and accepts a custom grace period', async () => {
    const { store } = makeStore();
    await runMuseumCleanup(store, { now: NOW, batchSize: 999, graceMs: 5_000 });
    expect(store.listExpired).toHaveBeenCalledWith(NOW.toISOString(), 100);
    expect(store.listAbandoned).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 5_000).toISOString(),
      100
    );

    await runMuseumCleanup(store, { now: NOW, batchSize: 0 });
    expect(store.listExpired).toHaveBeenLastCalledWith(NOW.toISOString(), 25);
  });

  it('defaults to the current time when none is supplied', async () => {
    const { store } = makeStore();
    const before = Date.now();
    await runMuseumCleanup(store);
    const after = Date.now();

    const passed = Date.parse(store.listExpired.mock.calls[0][0]);
    expect(passed).toBeGreaterThanOrEqual(before);
    expect(passed).toBeLessThanOrEqual(after);
  });

  it('ignores rows without an id', async () => {
    const { store } = makeStore({
      listExpired: async () => [{}, null, { id: 'museum-1' }, { id: 'museum-1' }],
    });

    const summary = await runMuseumCleanup(store, { now: NOW });

    expect(summary.scanned).toBe(1);
    expect(store.deleteMuseum).toHaveBeenCalledTimes(1);
  });
});
