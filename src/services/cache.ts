import type { OneDriveArticleMeta } from '../types';

const DB_NAME = 'TransmogrifiaPWA';
const DB_VERSION = 3;
const META_STORE = 'metadata';
const HTML_STORE = 'html';
const SETTINGS_STORE = 'settings';
const IMAGE_STORE = 'images';

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
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE); // key-value store, key = 'envelope'
      }
      if (!database.objectStoreNames.contains(IMAGE_STORE)) {
        database.createObjectStore(IMAGE_STORE); // key = "{articleId}/{assetId}", value = Blob
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

/**
 * Merge delta sync results into the cache.
 * Upserts changed articles and removes deleted ones.
 * Returns the full list of cached metadata after the merge.
 */
export async function mergeDeltaIntoCache(
  upserted: OneDriveArticleMeta[],
  deleted: string[],
): Promise<OneDriveArticleMeta[]> {
  const database = await getDB();

  // Phase 1: Read existing metadata to detect size changes (content regeneration)
  const staleIds: string[] = [];
  if (upserted.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(META_STORE, 'readonly');
      const metaStore = tx.objectStore(META_STORE);
      let pending = upserted.length;
      for (const meta of upserted) {
        const req = metaStore.get(meta.id);
        req.onsuccess = () => {
          const existing = req.result as OneDriveArticleMeta | undefined;
          if (existing && existing.size !== meta.size) {
            staleIds.push(meta.id);
          }
          if (--pending === 0) resolve();
        };
        req.onerror = () => {
          if (--pending === 0) resolve();
        };
      }
      tx.onerror = () => reject(tx.error);
    });
  }

  // Phase 2: Apply changes + invalidate stale content
  const stores = [META_STORE, HTML_STORE];
  if (staleIds.length > 0) stores.push(IMAGE_STORE);

  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const htmlStore = tx.objectStore(HTML_STORE);

    // Upsert changed metadata
    for (const meta of upserted) {
      metaStore.put(meta);
    }

    // Delete removed articles (both meta and HTML)
    for (const id of deleted) {
      metaStore.delete(id);
      htmlStore.delete(id);
    }

    // Invalidate cached HTML for articles whose size changed (regenerated content)
    for (const id of staleIds) {
      htmlStore.delete(id);
    }

    // Invalidate cached images for regenerated articles
    if (staleIds.length > 0) {
      const imgStore = tx.objectStore(IMAGE_STORE);
      const imgKeyReq = imgStore.getAllKeys();
      imgKeyReq.onsuccess = () => {
        const staleSet = new Set(staleIds);
        for (const key of imgKeyReq.result) {
          const articleId = String(key).split('/')[0];
          if (staleSet.has(articleId)) {
            imgStore.delete(key);
          }
        }
      };
    }

    tx.oncomplete = async () => {
      // Return the full updated list
      const allMeta = await getCachedMeta();
      resolve(allMeta);
    };
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

/**
 * Replace the metadata cache with the authoritative list from OneDrive and
 * remove orphaned HTML entries whose articles no longer exist.
 * Used after a full re-sync (first load or delta-token reset) to ensure the
 * local cache exactly mirrors what's on the server.
 */
export async function reconcileCache(
  currentArticles: OneDriveArticleMeta[],
): Promise<OneDriveArticleMeta[]> {
  const currentIds = new Set(currentArticles.map(m => m.id));
  const database = await getDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction([META_STORE, HTML_STORE, IMAGE_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const htmlStore = tx.objectStore(HTML_STORE);
    const imgStore = tx.objectStore(IMAGE_STORE);

    // Replace all metadata
    metaStore.clear();
    for (const meta of currentArticles) {
      metaStore.put(meta);
    }

    // Remove HTML blobs for articles that no longer exist on the server
    const htmlKeyReq = htmlStore.getAllKeys();
    htmlKeyReq.onsuccess = () => {
      for (const key of htmlKeyReq.result) {
        if (!currentIds.has(String(key))) {
          htmlStore.delete(key);
        }
      }
    };

    // Remove cached images for articles that no longer exist
    const imgKeyReq = imgStore.getAllKeys();
    imgKeyReq.onsuccess = () => {
      for (const key of imgKeyReq.result) {
        const articleId = String(key).split('/')[0];
        if (!currentIds.has(articleId)) {
          imgStore.delete(key);
        }
      }
    };

    tx.oncomplete = () => resolve(currentArticles);
    tx.onerror = () => reject(tx.error);
  });
}

/** Wrapper stored in the HTML cache alongside the content */
interface CachedHtmlEntry {
  html: string;
  /** Article size at cache time — used to detect regenerated articles */
  size: number;
}

/** Cache article HTML with the article's size for staleness detection */
export async function cacheHtml(id: string, html: string, size: number): Promise<void> {
  const database = await getDB();
  const entry: CachedHtmlEntry = { html, size };
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readwrite');
    tx.objectStore(HTML_STORE).put(entry, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get cached article HTML.
 * If `expectedSize` is provided, the cached entry is treated as stale (returns null)
 * when the stored size doesn't match — this catches regenerated articles whose
 * HTML content has changed on another device.
 */
export async function getCachedHtml(
  id: string,
  expectedSize?: number,
): Promise<string | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readonly');
    const req = tx.objectStore(HTML_STORE).get(id);
    req.onsuccess = () => {
      const value = req.result;
      if (value == null) return resolve(null);

      // Legacy entries are plain strings (pre-staleness-tracking)
      if (typeof value === 'string') {
        // No size info — if caller requires a freshness check, treat as stale
        return resolve(expectedSize != null ? null : value);
      }

      // New format: { html, size }
      const entry = value as CachedHtmlEntry;
      if (expectedSize != null && entry.size !== expectedSize) {
        return resolve(null); // Content has changed — stale
      }
      return resolve(entry.html);
    };
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

// ─── Image cache ────────────────

/** Get a cached image blob, or null if not cached */
export async function getCachedImage(
  articleId: string,
  assetId: string,
): Promise<Blob | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IMAGE_STORE, 'readonly');
    const req = tx.objectStore(IMAGE_STORE).get(`${articleId}/${assetId}`);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Store an image blob in the cache */
export async function cacheImage(
  articleId: string,
  assetId: string,
  blob: Blob,
): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).put(blob, `${articleId}/${assetId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get the cached dominant color for an image, or null */
export async function getCachedImageColor(
  articleId: string,
  assetId: string,
): Promise<string | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IMAGE_STORE, 'readonly');
    const req = tx.objectStore(IMAGE_STORE).get(`color:${articleId}/${assetId}`);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Store the dominant color for an image */
export async function cacheImageColor(
  articleId: string,
  assetId: string,
  color: string,
): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IMAGE_STORE, 'readwrite');
    tx.objectStore(IMAGE_STORE).put(color, `color:${articleId}/${assetId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Batch-read dominant colors for multiple images in a single transaction */
export async function getCachedImageColors(
  articleId: string,
  assetIds: string[],
): Promise<Map<string, string>> {
  if (assetIds.length === 0) return new Map();
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IMAGE_STORE, 'readonly');
    const store = tx.objectStore(IMAGE_STORE);
    const results = new Map<string, string>();
    let pending = assetIds.length;
    for (const assetId of assetIds) {
      const req = store.get(`color:${articleId}/${assetId}`);
      req.onsuccess = () => {
        if (req.result) results.set(assetId, req.result as string);
        if (--pending === 0) resolve(results);
      };
      req.onerror = () => {
        if (--pending === 0) resolve(results);
      };
    }
    tx.onerror = () => reject(tx.error);
  });
}

/** Delete all cached images for a specific article */
export async function deleteCachedImages(articleId: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(IMAGE_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const prefix = `${articleId}/`;
      for (const key of req.result) {
        if (String(key).startsWith(prefix)) {
          store.delete(key);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

/** Delete a single article from cache (both meta, HTML, and images) */
export async function deleteCachedArticle(id: string): Promise<void> {
  await deleteCachedImages(id);
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([META_STORE, HTML_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(HTML_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Clear all cached data */
export async function clearCache(): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([META_STORE, HTML_STORE, IMAGE_STORE], 'readwrite');
    tx.objectStore(META_STORE).clear();
    tx.objectStore(HTML_STORE).clear();
    tx.objectStore(IMAGE_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Settings store helpers ────────────────

/** Get a value from the settings store */
export async function getSettingsValue<T>(key: string): Promise<T | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(SETTINGS_STORE, 'readonly');
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Put a value into the settings store */
export async function setSettingsValue<T>(key: string, value: T): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Remove a value from the settings store */
export async function removeSettingsValue(key: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
