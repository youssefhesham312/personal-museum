import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  initDB,
  savePhoto,
  getAllPhotos,
  getPhotoCount,
  clearAllPhotos,
  updatePhoto,
  deletePhoto,
  reorderPhotos,
  _resetDB,
} from './db.js';

describe('photo storage', () => {
  beforeEach(async () => {
    _resetDB();
    indexedDB.deleteDatabase('personal-museum');
  });

  it('should initialize the database', async () => {
    const db = await initDB();
    expect(db).toBeDefined();
    db.close();
  });

  it('should save and retrieve a photo', async () => {
    const blob = new Blob(['fake-image'], { type: 'image/png' });
    const photo = { blob, name: 'test.png', width: 800, height: 600 };

    await savePhoto(photo);
    const photos = await getAllPhotos();

    expect(photos).toHaveLength(1);
    expect(photos[0].name).toBe('test.png');
    expect(photos[0].width).toBe(800);
    expect(photos[0].height).toBe(600);
    expect(photos[0].blob).toBeInstanceOf(Blob);
    expect(photos[0].id).toBeDefined();
    expect(photos[0].addedAt).toBeDefined();
  });

  it('should save multiple photos and return all', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });
    await savePhoto({ blob, name: 'c.png', width: 300, height: 300 });

    const photos = await getAllPhotos();
    expect(photos).toHaveLength(3);
  });

  it('should return photo count', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    expect(await getPhotoCount()).toBe(0);

    await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    expect(await getPhotoCount()).toBe(1);

    await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });
    expect(await getPhotoCount()).toBe(2);
  });

  it('should clear all photos', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });

    await clearAllPhotos();
    expect(await getPhotoCount()).toBe(0);
  });

  it('assigns stable positions in upload order', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    const first = await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    const second = await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);
    expect((await getAllPhotos()).map((photo) => photo.name)).toEqual(['a.png', 'b.png']);
  });

  it('updates a caption and date without changing the order', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    const first = await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });

    await updatePhoto(first.id, { caption: 'The first day', date: 'June 2024' });
    const photos = await getAllPhotos();

    expect(photos[0].caption).toBe('The first day');
    expect(photos[0].date).toBe('June 2024');
    expect(photos[1].caption).toBe('');
  });

  it('reorders photos and keeps the new order', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    const first = await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    const second = await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });
    const third = await savePhoto({ blob, name: 'c.png', width: 300, height: 300 });

    await reorderPhotos([third.id, first.id, second.id]);

    expect((await getAllPhotos()).map((photo) => photo.name)).toEqual(['c.png', 'a.png', 'b.png']);
    expect((await getAllPhotos()).map((photo) => photo.position)).toEqual([0, 1, 2]);
  });

  it('deletes one photo without disturbing the rest', async () => {
    const blob = new Blob(['fake'], { type: 'image/png' });
    const first = await savePhoto({ blob, name: 'a.png', width: 100, height: 100 });
    const second = await savePhoto({ blob, name: 'b.png', width: 200, height: 200 });

    await deletePhoto(first.id);

    expect((await getAllPhotos()).map((photo) => photo.name)).toEqual(['b.png']);
    expect(await getPhotoCount()).toBe(1);
    expect(second.id).toBeDefined();
  });
});
