import { getAccessToken } from './auth';
import type { OneDriveArticleMeta, UserProfile } from '../types';
import type { SyncEncryptedEnvelope, LegacyEncryptedEnvelope } from './crypto';
import { safeGetItem, safeSetItem, safeRemoveItem } from '../utils/storage';
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
const INDEX_FILE = `${APP_FOLDER}/_index.json`;
const METADATA_CONCURRENCY = 6;

/** Describes a metadata file to download (collected before batch download) */
interface MetaDownloadItem {
  id: string;
  directUrl?: string;
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
  const savedToken = safeGetItem(DELTA_TOKEN_KEY);
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
      const res: Response = await fetch(url, { headers });

      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          // Folder doesn't exist yet or delta token expired — fall back to full list
          safeRemoveItem(DELTA_TOKEN_KEY);
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
        toDownload.push({ id, directUrl });
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
      safeRemoveItem(DELTA_TOKEN_KEY);
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
      safeSetItem(DELTA_TOKEN_KEY, finalDeltaLink);
    } else {
      console.warn('Delta token not saved — some metadata download(s) failed; will retry next sync');
    }
  }

  // De-duplicate deleted IDs
  const uniqueDeleted = [...new Set(deleted)];

  return { upserted, deleted: uniqueDeleted, fullSync: isFullSync, usedIndex: false };
}

/** Clear the saved delta token (used when signing out / clearing cache) */
export function clearDeltaToken(): void {
  safeRemoveItem(DELTA_TOKEN_KEY);
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

  try {
    while (url) {
      const res = await fetch(url, { headers });
      if (!res.ok) return { newMetas: [], deletedIds: [] };

      const data: Record<string, unknown> = await res.json();
      const items = (data.value as Array<Record<string, unknown>>) || [];

      for (const item of items) {
        const name = item.name as string | undefined;
        if (!name) continue;

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
        safeSetItem(DELTA_TOKEN_KEY, deltaLink);
        url = null;
      } else {
        url = nextLink || null;
      }
    }

    // Download metadata for articles not in the index (parallel batches)
    let newMetas: OneDriveArticleMeta[] = [];
    if (toDownload.length > 0) {
      const { metas } = await downloadMetaBatch(toDownload, headers);
      newMetas = metas;
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
    const res: Response = await fetch(url, { headers });

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
    { headers },
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
          const res = await fetch(item.directUrl);
          if (!res.ok) throw new Error(`Direct download failed: ${res.status}`);
          return res.json() as Promise<OneDriveArticleMeta>;
        }
        return downloadMeta(item.id, headers);
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        metas.push(result.value);
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
    const res = await fetch(graphContentUrl(INDEX_FILE), { headers });
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
    { headers },
  );
  if (!res.ok) throw new Error(`Download HTML failed: ${res.status}`);
  return res.text();
}

/**
 * Upload updated metadata (used for favorite toggle).
 */
export async function uploadMeta(meta: OneDriveArticleMeta): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    graphContentUrl(articleMetaPath(meta.id)),
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(meta, null, 2),
    },
  );
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
    { headers },
  );
  if (!res.ok) throw new Error(`Download asset failed: ${res.status}`);
  return res.blob();
}

/**
 * Fetch the signed-in user's profile.
 */
export async function getUserProfile(): Promise<UserProfile> {
  const headers = await authHeaders();
  const res = await fetch(`${GRAPH_BASE}/me`, { headers });
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

// ─── Encrypted settings sync ────────────────

/** Shape of settings.enc.json on OneDrive (matches extension format) */
export interface CloudSettingsFile {
  envelope: SyncEncryptedEnvelope | LegacyEncryptedEnvelope;
  updatedAt: number;
}

/**
 * Download encrypted settings from OneDrive AppFolder.
 * Returns the parsed wrapper (envelope + updatedAt), or null if no settings file exists (404).
 */
export async function downloadSettings(): Promise<CloudSettingsFile | null> {
  const headers = await authHeaders();
  const res = await fetch(
    graphContentUrl(SETTINGS_FILE),
    { headers },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Download settings failed: ${res.status}`);
  return res.json();
}

/**
 * Upload encrypted settings to OneDrive AppFolder.
 * Wraps the envelope in `{ envelope, updatedAt }` to match the extension format.
 */
export async function uploadSettings(envelope: SyncEncryptedEnvelope, updatedAt: number): Promise<void> {
  const headers = await authHeaders();
  const payload: CloudSettingsFile = { envelope, updatedAt };
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
