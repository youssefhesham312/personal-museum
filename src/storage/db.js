import { openDB } from 'idb';

const DB_NAME = 'personal-museum';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

let dbInstance = null;

export async function initDB() {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
  return dbInstance;
}

/** Records created before ordering existed fall back to their insertion id. */
function positionOf(photo) {
  const position = Number(photo?.position);
  if (Number.isFinite(position)) return position;
  const id = Number(photo?.id);
  return Number.isFinite(id) ? id : 0;
}

function sortPhotos(photos) {
  return photos.sort(
    (a, b) =>
      positionOf(a) - positionOf(b) ||
      (Number(a?.id) || 0) - (Number(b?.id) || 0)
  );
}

export async function savePhoto({ blob, name, width, height, caption = '', date = '', position }) {
  const db = await initDB();
  const all = await db.getAll(STORE_NAME);
  const nextPosition =
    Number.isFinite(Number(position))
      ? Number(position)
      : all.reduce((max, photo) => Math.max(max, positionOf(photo)), 0) + 1;

  const record = {
    blob,
    name,
    width,
    height,
    caption: String(caption || ''),
    date: String(date || ''),
    position: nextPosition,
    addedAt: Date.now(),
  };
  const id = await db.add(STORE_NAME, record);
  return { ...record, id };
}

export async function updatePhoto(id, patch = {}) {
  const db = await initDB();
  const existing = await db.get(STORE_NAME, id);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: Date.now(),
  };
  await db.put(STORE_NAME, next);
  return next;
}

export async function deletePhoto(id) {
  const db = await initDB();
  await db.delete(STORE_NAME, id);
}

/**
 * Persist an explicit order. Positions are rewritten as 0..n-1; photos that no
 * longer exist are ignored.
 */
export async function reorderPhotos(orderedIds = []) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const ids = Array.from(orderedIds, (id) => Number(id)).filter(Number.isFinite);

  try {
    for (let index = 0; index < ids.length; index += 1) {
      const record = await tx.store.get(ids[index]);
      if (!record) continue;
      await tx.store.put({ ...record, position: index, updatedAt: Date.now() });
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    throw error;
  }
}

export async function getAllPhotos() {
  const db = await initDB();
  return sortPhotos(await db.getAll(STORE_NAME));
}

export async function getPhotoCount() {
  const db = await initDB();
  return db.count(STORE_NAME);
}

export async function clearAllPhotos() {
  const db = await initDB();
  return db.clear(STORE_NAME);
}

/** Close the cached connection and reset — used by tests. */
export function _resetDB() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
