import type { OneDriveArticleMeta } from '../types';

const DB_NAME = 'TransmogrifiaPWA';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const HTML_STORE = 'html';

let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);

    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        const store = database.createObjectStore(META_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('isFavorite', 'isFavorite');
        store.createIndex('recipeId', 'recipeId');
      }
      if (!database.objectStoreNames.contains(HTML_STORE)) {
        database.createObjectStore(HTML_STORE); // keyed by article id
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
  });
}

/** Save or update article metadata in cache */
export async function cacheMeta(meta: OneDriveArticleMeta): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Bulk update all metadata (replace entire cache) */
export async function cacheAllMeta(metas: OneDriveArticleMeta[]): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    store.clear();
    for (const meta of metas) store.put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all cached metadata */
export async function getCachedMeta(): Promise<OneDriveArticleMeta[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Cache article HTML */
export async function cacheHtml(id: string, html: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readwrite');
    tx.objectStore(HTML_STORE).put(html, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get cached article HTML (null if not cached) */
export async function getCachedHtml(id: string): Promise<string | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readonly');
    const req = tx.objectStore(HTML_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Get set of all cached HTML article IDs */
export async function getCachedHtmlIds(): Promise<Set<string>> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readonly');
    const req = tx.objectStore(HTML_STORE).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result.map(String)));
    req.onerror = () => reject(req.error);
  });
}

/** Get cache statistics */
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
  const metas = await getCachedMeta();
  const cachedIds = await getCachedHtmlIds();
  const cachedMetas = metas.filter(m => cachedIds.has(m.id));
  return {
    count: cachedIds.size,
    totalSize: cachedMetas.reduce((sum, m) => sum + m.size, 0),
  };
}

/** Clear all cached data */
export async function clearCache(): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([META_STORE, HTML_STORE], 'readwrite');
    tx.objectStore(META_STORE).clear();
    tx.objectStore(HTML_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
