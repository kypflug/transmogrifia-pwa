import { getAccessToken } from './auth';
import type { OneDriveArticleMeta, UserProfile } from '../types';
import type { SyncEncryptedEnvelope, LegacyEncryptedEnvelope } from './crypto';
import { safeGetItem, safeRemoveItem } from '../utils/storage';
import { getSettingsValue, setSettingsValue, removeSettingsValue } from './cache';
import {
  GRAPH_BASE,
  APP_FOLDER,
  SETTINGS_FILE,
  articleHtmlPath,
  articleMetaPath,
  graphContentUrl,
  graphFolderChildrenUrl,
  graphItemUrl,
} from '@kypflug/transmogrifier-core';
const DELTA_TOKEN_KEY = 'transmogrifia_delta_token';
/** Legacy localStorage key — used for one-time migration to IndexedDB */
const DELTA_TOKEN_LS_KEY = 'transmogrifia_delta_token';
const INDEX_FILE = `${APP_FOLDER}/_index.json`;
const METADATA_CONCURRENCY = 6;

// ─── Delta token persistence (IndexedDB with localStorage migration) ───

/**
 * Read the delta token, migrating from localStorage to IndexedDB on first run.
 * Returns the token string or null if none exists.
 */
async function getDeltaToken(): Promise<string | null> {
  // Check IndexedDB first (primary store)
  const idbToken = await getSettingsValue<string>(DELTA_TOKEN_KEY);
  if (idbToken) return idbToken;

  // One-time migration: read from legacy localStorage
  const lsToken = safeGetItem(DELTA_TOKEN_LS_KEY);
  if (lsToken) {
    console.debug('[Sync] Migrating delta token from localStorage to IndexedDB');
    await setSettingsValue(DELTA_TOKEN_KEY, lsToken);
    safeRemoveItem(DELTA_TOKEN_LS_KEY);
    return lsToken;
  }

  return null;
}

/** Save the delta token to IndexedDB. */
async function saveDeltaToken(token: string): Promise<void> {
  await setSettingsValue(DELTA_TOKEN_KEY, token);
}

/** Remove the delta token from both IndexedDB and legacy localStorage. */
async function removeDeltaToken(): Promise<void> {
  await removeSettingsValue(DELTA_TOKEN_KEY);
  safeRemoveItem(DELTA_TOKEN_LS_KEY); // clean up legacy if still present
}

/** Check whether a delta token exists (Fix 16: used by divergence detection). */
export async function hasDeltaToken(): Promise<boolean> {
  const token = await getSettingsValue<string>(DELTA_TOKEN_KEY);
  return !!token;
}

/** Describes a metadata file to download (collected before batch download) */
interface MetaDownloadItem {
  id: string;
  directUrl?: string;
  /** Drive item eTag captured from delta/list responses (Fix 11) */
  eTag?: string;
}

/** Shape of the _index.json file on OneDrive */
interface ArticleIndex {
  version: 1;
  updatedAt: number;
  articles: OneDriveArticleMeta[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

/** Result of a delta sync operation */
export interface DeltaSyncResult {
  /** Updated or new article metadata */
  upserted: OneDriveArticleMeta[];
  /** IDs of deleted articles */
  deleted: string[];
  /** True when the entire article list was fetched (not incremental) — caller should reconcile cache */
  fullSync: boolean;
  /** True when the result came from the article index (caller should bootstrap delta token) */
  usedIndex: boolean;
}

/**
 * Sync articles using the Graph delta API.
 * On first call (no saved token), tries the article index for a fast single-request sync.
 * On subsequent calls, only returns changes since the last sync.
 */
export async function syncArticles(): Promise<DeltaSyncResult> {
  const headers = await authHeaders();
  const savedToken = await getDeltaToken();
  const isFullSync = !savedToken;

  // For full syncs (no delta token), try the fast index path first
  if (isFullSync) {
    const indexMetas = await downloadIndex(headers);
    if (indexMetas !== null) {
      return { upserted: indexMetas, deleted: [], fullSync: true, usedIndex: true };
    }
  }

  // Use saved delta link if available, otherwise start fresh
  let url: string | null = savedToken
    ? savedToken
    : `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/delta`;

  const upserted: OneDriveArticleMeta[] = [];
  const deleted: string[] = [];
  const toDownload: MetaDownloadItem[] = [];
  let finalDeltaLink: string | null = null;

  try {
    while (url) {
      const res: Response = await fetch(url, { headers, cache: 'no-store' });

      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          // Folder doesn't exist yet or delta token expired — fall back to full list
          await removeDeltaToken();
          const allMeta = await listArticles();
          return { upserted: allMeta, deleted: [], fullSync: true, usedIndex: false };
        }
        const body = await res.text().catch(() => '');
        throw new Error(`Delta sync failed: ${res.status} ${body}`);
      }

      const data: Record<string, unknown> = await res.json();
      const items = (data.value as Array<Record<string, unknown>>) || [];

      // Collect phase: gather download targets and deletions
      for (const item of items) {
        const name = item.name as string | undefined;
        if (!name) continue;
        // Skip internal files like _index.json (Fix 4: S2)
        if (name.startsWith('_')) continue;

        // Check if item was deleted (Graph uses both `deleted` facet and `@removed` annotation)
        if (item.deleted || item['@removed']) {
          if (name.endsWith('.json')) {
            deleted.push(name.replace('.json', ''));
          } else if (name.endsWith('.html')) {
            deleted.push(name.replace('.html', ''));
          }
          continue;
        }

        // Only process .json metadata files
        if (!name.endsWith('.json')) continue;
        const id = name.replace('.json', '');
        const directUrl = item['@microsoft.graph.downloadUrl'] as string | undefined;
        const itemETag = item.eTag as string | undefined;
        toDownload.push({ id, directUrl, eTag: itemETag });
      }

      // Follow nextLink for more pages, or capture the delta link when done
      const deltaLink = data['@odata.deltaLink'] as string | undefined;
      const nextLink = data['@odata.nextLink'] as string | undefined;

      if (deltaLink) {
        finalDeltaLink = deltaLink;
        url = null;
      } else {
        url = nextLink || null;
      }
    }
  } catch (err) {
    // If the saved token caused an error, clear it and throw
    if (savedToken) {
      await removeDeltaToken();
    }
    throw err;
  }

  // Download phase: fetch all metadata in parallel batches
  let hasDownloadFailures = false;
  if (toDownload.length > 0) {
    const { metas, failureCount } = await downloadMetaBatch(toDownload, headers);
    upserted.push(...metas);
    hasDownloadFailures = failureCount > 0;
  }

  // Only persist the delta token if ALL items were successfully downloaded.
  if (finalDeltaLink) {
    if (!hasDownloadFailures) {
      await saveDeltaToken(finalDeltaLink);
    } else {
      console.warn('Delta token not saved — some metadata download(s) failed; will retry next sync');
    }
  }

  // De-duplicate deleted IDs
  const uniqueDeleted = [...new Set(deleted)];

  return { upserted, deleted: uniqueDeleted, fullSync: isFullSync, usedIndex: false };
}

/** Clear the saved delta token (used when signing out / clearing cache) */
export async function clearDeltaToken(): Promise<void> {
  await removeDeltaToken();
}

/**
 * Rebuild and re-upload the article index on OneDrive.
 * Fire-and-forget safe — failures are logged but not thrown.
 */
export async function rebuildIndex(articles: OneDriveArticleMeta[]): Promise<void> {
  try {
    const headers = await authHeaders();
    await uploadIndex(articles, headers);
  } catch (err) {
    console.warn('Failed to rebuild index:', err);
  }
}

/** Result of bootstrapping a delta token from a full index sync */
export interface BootstrapResult {
  /** Articles found in the delta that were NOT in the index */
  newMetas: OneDriveArticleMeta[];
  /** Article IDs that were deleted since the index was built */
  deletedIds: string[];
}

/**
 * After an index-based sync, page through the delta API to:
 * 1. Get a delta token for subsequent incremental syncs
 * 2. Discover any articles added/deleted since the index was last built
 *
 * Does NOT download metadata for items already in knownIds.
 * Fire-and-forget safe — failures are logged but not thrown.
 */
export async function bootstrapDeltaToken(
  knownIds: Set<string>,
): Promise<BootstrapResult> {
  const headers = await authHeaders();
  let url: string | null = `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/delta`;
  const toDownload: MetaDownloadItem[] = [];
  const deletedIds: string[] = [];
  let finalDeltaLink: string | null = null;

  try {
    while (url) {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) return { newMetas: [], deletedIds: [] };

      const data: Record<string, unknown> = await res.json();
      const items = (data.value as Array<Record<string, unknown>>) || [];

      for (const item of items) {
        const name = item.name as string | undefined;
        if (!name) continue;
        // Skip internal files like _index.json (Fix 4: S2)
        if (name.startsWith('_')) continue;

        if (item.deleted || item['@removed']) {
          if (name.endsWith('.json')) {
            const id = name.replace('.json', '');
            if (knownIds.has(id)) deletedIds.push(id);
          }
          continue;
        }

        if (!name.endsWith('.json')) continue;
        const id = name.replace('.json', '');
        // Only download metadata for articles NOT already in the index
        if (!knownIds.has(id)) {
          const directUrl = item['@microsoft.graph.downloadUrl'] as string | undefined;
          toDownload.push({ id, directUrl });
        }
      }

      const deltaLink = data['@odata.deltaLink'] as string | undefined;
      const nextLink = data['@odata.nextLink'] as string | undefined;

      if (deltaLink) {
        // Delta token saved AFTER downloads complete (see below)
        finalDeltaLink = deltaLink;
        url = null;
      } else {
        url = nextLink || null;
      }
    }

    // Download metadata for articles not in the index (parallel batches)
    let newMetas: OneDriveArticleMeta[] = [];
    let hasDownloadFailures = false;
    if (toDownload.length > 0) {
      const { metas, failureCount } = await downloadMetaBatch(toDownload, headers);
      newMetas = metas;
      hasDownloadFailures = failureCount > 0;
    }

    // Only persist the delta token AFTER all downloads complete successfully.
    // Previously this was saved as soon as the delta link arrived, before
    // metadata downloads finished — meaning partially-failed downloads were
    // permanently invisible to future incremental syncs (Fix 5).
    if (finalDeltaLink && !hasDownloadFailures) {
      await saveDeltaToken(finalDeltaLink);
      console.debug('[Sync] Bootstrap delta token saved');
    } else if (finalDeltaLink) {
      console.warn('[Sync] Bootstrap delta token NOT saved — some metadata downloads failed');
    }

    return { newMetas, deletedIds: [...new Set(deletedIds)] };
  } catch (err) {
    console.warn('Delta token bootstrap failed:', err);
    return { newMetas: [], deletedIds: [] };
  }
}

/**
 * List all article metadata from OneDrive.
 * Fetches all .json files from the articles folder and downloads each one in parallel.
 */
export async function listArticles(): Promise<OneDriveArticleMeta[]> {
  const headers = await authHeaders();
  const toDownload: MetaDownloadItem[] = [];

  // Don't use $filter — it's not supported on consumer OneDrive.
  // Filter for .json files client-side instead.
  let url: string | null =
    graphFolderChildrenUrl(APP_FOLDER) +
    `?$select=name&$top=200`;

  while (url) {
    const res: Response = await fetch(url, { headers, cache: 'no-store' });

    if (!res.ok) {
      if (res.status === 404) return []; // no articles folder yet
      const body = await res.text().catch(() => '');
      throw new Error(`List articles failed: ${res.status} ${body}`);
    }

    const data: Record<string, unknown> = await res.json();

    const items = (data.value as Array<{ name: string }>) || [];
    for (const item of items) {
      const name: string = item.name;
      if (!name.endsWith('.json')) continue;
      // Skip internal files like _index.json (Fix 4: S2)
      if (name.startsWith('_')) continue;
      const id = name.replace('.json', '');
      toDownload.push({ id });
    }

    url = (data['@odata.nextLink'] as string) || null;
  }

  const { metas } = await downloadMetaBatch(toDownload, headers);
  return metas;
}

async function downloadMeta(
  id: string,
  headers: Record<string, string>,
): Promise<OneDriveArticleMeta> {
  const res = await fetch(
    graphContentUrl(articleMetaPath(id)),
    { headers, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Download meta failed: ${res.status}`);
  return res.json();
}

/**
 * Download metadata for multiple articles in parallel batches.
 */
async function downloadMetaBatch(
  items: MetaDownloadItem[],
  headers: Record<string, string>,
): Promise<{ metas: OneDriveArticleMeta[]; failureCount: number }> {
  const metas: OneDriveArticleMeta[] = [];
  let failureCount = 0;

  for (let i = 0; i < items.length; i += METADATA_CONCURRENCY) {
    const batch = items.slice(i, i + METADATA_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        if (item.directUrl) {
          const res = await fetch(item.directUrl, { cache: 'no-store' });
          if (!res.ok) throw new Error(`Direct download failed: ${res.status}`);
          return res.json() as Promise<OneDriveArticleMeta>;
        }
        return downloadMeta(item.id, headers);
      }),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        const meta = result.value;
        // Attach drive item eTag to the meta object for conditional writes (Fix 11)
        const sourceItem = batch[j];
        if (sourceItem.eTag) {
          (meta as unknown as Record<string, unknown>).eTag = sourceItem.eTag;
        }
        metas.push(meta);
      } else {
        console.warn('Metadata download failed:', result.reason);
        failureCount++;
      }
    }
  }

  return { metas, failureCount };
}

// ─── Article index ────────────────

/**
 * Download the lightweight article index from OneDrive.
 * Returns null if the index doesn't exist or can't be read (non-fatal).
 */
async function downloadIndex(
  headers: Record<string, string>,
): Promise<OneDriveArticleMeta[] | null> {
  try {
    const res = await fetch(graphContentUrl(INDEX_FILE), { headers, cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data: ArticleIndex = await res.json();
    if (data.version !== 1 || !Array.isArray(data.articles)) return null;
    return data.articles;
  } catch {
    return null;
  }
}

/**
 * Upload the article index to OneDrive (fire-and-forget safe).
 */
async function uploadIndex(
  articles: OneDriveArticleMeta[],
  headers: Record<string, string>,
): Promise<void> {
  const index: ArticleIndex = {
    version: 1,
    updatedAt: Date.now(),
    articles,
  };
  const res = await fetch(graphContentUrl(INDEX_FILE), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(index),
  });
  if (!res.ok) {
    console.warn('Index upload failed:', res.status);
  }
}

/**
 * Download article HTML content from OneDrive.
 */
export async function downloadArticleHtml(id: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(
    graphContentUrl(articleHtmlPath(id)),
    { headers, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Download HTML failed: ${res.status}`);
  return res.text();
}

/**
 * Upload updated metadata (used for favorite toggle, share).
 *
 * Uses If-Match with the article's ETag when available to prevent
 * last-write-wins data loss on concurrent edits from different devices.
 * On 412 Precondition Failed, re-downloads the server version, merges
 * the change, and retries once. (Fix 11)
 */
export async function uploadMeta(
  meta: OneDriveArticleMeta,
  mergeFn?: (local: OneDriveArticleMeta, remote: OneDriveArticleMeta) => OneDriveArticleMeta,
): Promise<void> {
  const headers = await authHeaders();
  const uploadHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': 'application/json',
  };

  // If the article has an eTag from a previous download, use conditional write
  // Note: eTag is populated at runtime from Graph API responses but is not part
  // of the shared OneDriveArticleMeta type definition.
  const eTag = (meta as unknown as Record<string, unknown>).eTag as string | undefined;
  if (eTag) {
    uploadHeaders['If-Match'] = eTag;
  }

  const res = await fetch(
    graphContentUrl(articleMetaPath(meta.id)),
    {
      method: 'PUT',
      headers: uploadHeaders,
      body: JSON.stringify(meta, null, 2),
    },
  );

  if (res.status === 412 && mergeFn) {
    // ETag conflict — re-download, merge, and retry without If-Match
    console.debug('[Sync] ETag conflict on uploadMeta for %s — merging and retrying', meta.id.substring(0, 8) + '…');
    try {
      const remoteMeta = await downloadMeta(meta.id, headers);
      const merged = mergeFn(meta, remoteMeta);
      merged.updatedAt = Date.now();
      const retryRes = await fetch(
        graphContentUrl(articleMetaPath(meta.id)),
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(merged, null, 2),
        },
      );
      if (!retryRes.ok) throw new Error(`Upload meta merge-retry failed: ${retryRes.status}`);
      // Update the in-memory meta with merged values
      Object.assign(meta, merged);
      return;
    } catch (mergeErr) {
      console.warn('[Sync] ETag merge-retry failed:', mergeErr);
      throw mergeErr;
    }
  }

  if (res.status === 412 && !mergeFn) {
    // No mergeFn provided — log for observability so we can revisit if frequent
    console.warn('[Sync] ETag 412 conflict on uploadMeta for %s — no mergeFn, failing', meta.id.substring(0, 8) + '…');
    throw new Error('Upload meta conflict: 412');
  }

  if (!res.ok) throw new Error(`Upload meta failed: ${res.status}`);
}

/**
 * Delete an article (both .json and .html) from OneDrive.
 */
export async function deleteArticle(id: string): Promise<void> {
  const headers = await authHeaders();
  const results = await Promise.allSettled([
    fetch(graphItemUrl(articleMetaPath(id)), {
      method: 'DELETE',
      headers,
    }),
    fetch(graphItemUrl(articleHtmlPath(id)), {
      method: 'DELETE',
      headers,
    }),
    fetch(graphItemUrl(`${APP_FOLDER}/${id}`), {
      method: 'DELETE',
      headers,
    }),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled' && !r.value.ok && r.value.status !== 404) {
      throw new Error(`Delete failed: ${r.value.status}`);
    }
  }
}

/**
 * Download a binary asset from OneDrive (e.g., stored images).
 */
export async function downloadArticleAsset(drivePath: string): Promise<Blob> {
  const headers = await authHeaders();
  const res = await fetch(
    graphContentUrl(drivePath),
    { headers, cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`Download asset failed: ${res.status}`);
  return res.blob();
}

/**
 * Fetch the signed-in user's profile.
 */
export async function getUserProfile(): Promise<UserProfile> {
  const headers = await authHeaders();
  const res = await fetch(`${GRAPH_BASE}/me`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

// ─── Encrypted settings sync ────────────────

/** Shape of settings.enc.json on OneDrive (matches extension format) */
export interface CloudSettingsFile {
  envelope: SyncEncryptedEnvelope | LegacyEncryptedEnvelope;
  updatedAt: number;
  /** Monotonic version counter for clock-skew-safe conflict resolution (Fix 17) */
  syncVersion?: number;
}

/**
 * Download encrypted settings from OneDrive AppFolder.
 * Returns the parsed wrapper (envelope + updatedAt), or null if no settings file exists (404).
 */
export async function downloadSettings(): Promise<CloudSettingsFile | null> {
  const headers = await authHeaders();
  const res = await fetch(
    graphContentUrl(SETTINGS_FILE),
    { headers, cache: 'no-store' },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Download settings failed: ${res.status}`);
  return res.json();
}

/**
 * Upload encrypted settings to OneDrive AppFolder.
 * Wraps the envelope in `{ envelope, updatedAt }` to match the extension format.
 */
export async function uploadSettings(envelope: SyncEncryptedEnvelope, updatedAt: number, syncVersion?: number): Promise<void> {
  const headers = await authHeaders();
  const payload: CloudSettingsFile = { envelope, updatedAt };
  if (syncVersion != null) payload.syncVersion = syncVersion;
  const res = await fetch(
    graphContentUrl(SETTINGS_FILE),
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(`Upload settings failed: ${res.status}`);
}
