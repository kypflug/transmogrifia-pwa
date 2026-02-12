import { getAccessToken } from './auth';
import type { OneDriveArticleMeta, UserProfile } from '../types';
import type { SyncEncryptedEnvelope, LegacyEncryptedEnvelope } from './crypto';
import { safeGetItem, safeSetItem, safeRemoveItem } from '../utils/storage';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER = 'articles';
const SETTINGS_PATH = 'settings.enc.json';
const DELTA_TOKEN_KEY = 'transmogrifia_delta_token';

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
}

/**
 * Sync articles using the Graph delta API.
 * On first call (no saved token), fetches everything — equivalent to listArticles.
 * On subsequent calls, only returns changes since the last sync.
 */
export async function syncArticles(): Promise<DeltaSyncResult> {
  const headers = await authHeaders();
  const savedToken = safeGetItem(DELTA_TOKEN_KEY);
  const isFullSync = !savedToken;

  // Use saved delta link if available, otherwise start fresh
  let url: string | null = savedToken
    ? savedToken
    : `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/delta`;

  const upserted: OneDriveArticleMeta[] = [];
  const deleted: string[] = [];
  let hasDownloadFailures = false;

  try {
    while (url) {
      const res: Response = await fetch(url, { headers });

      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          // Folder doesn't exist yet or delta token expired — fall back to full list
          safeRemoveItem(DELTA_TOKEN_KEY);
          const allMeta = await listArticles();
          return { upserted: allMeta, deleted: [], fullSync: true };
        }
        const body = await res.text().catch(() => '');
        throw new Error(`Delta sync failed: ${res.status} ${body}`);
      }

      const data: Record<string, unknown> = await res.json();
      const items = (data.value as Array<Record<string, unknown>>) || [];

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
        try {
          // Use @microsoft.graph.downloadUrl if available (avoids extra API call)
          const directUrl = item['@microsoft.graph.downloadUrl'] as string | undefined;
          let meta: OneDriveArticleMeta;
          if (directUrl) {
            const dlRes = await fetch(directUrl);
            if (!dlRes.ok) throw new Error(`Direct download failed: ${dlRes.status}`);
            meta = await dlRes.json();
          } else {
            meta = await downloadMeta(id, headers);
          }
          upserted.push(meta);
        } catch (err) {
          console.warn('Skipping unreadable metadata:', name, err);
          hasDownloadFailures = true;
        }
      }

      // Follow nextLink for more pages, or save the delta link when done
      const deltaLink = data['@odata.deltaLink'] as string | undefined;
      const nextLink = data['@odata.nextLink'] as string | undefined;

      if (deltaLink) {
        // Only persist the delta token if ALL items were successfully downloaded.
        // If any downloads failed, the next sync will re-fetch from the last
        // good token and retry the failed items.
        if (!hasDownloadFailures) {
          safeSetItem(DELTA_TOKEN_KEY, deltaLink);
        } else {
          console.warn('Delta token not saved — %d metadata download(s) failed; will retry next sync',
            upserted.length === 0 ? 'all' : 'some');
        }
        url = null; // done
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

  // De-duplicate deleted IDs
  const uniqueDeleted = [...new Set(deleted)];

  return { upserted, deleted: uniqueDeleted, fullSync: isFullSync };
}

/** Clear the saved delta token (used when signing out / clearing cache) */
export function clearDeltaToken(): void {
  safeRemoveItem(DELTA_TOKEN_KEY);
}

/**
 * List all article metadata from OneDrive.
 * Fetches all .json files from the articles folder and downloads each one.
 */
export async function listArticles(): Promise<OneDriveArticleMeta[]> {
  const headers = await authHeaders();
  const metas: OneDriveArticleMeta[] = [];

  // Don't use $filter — it's not supported on consumer OneDrive.
  // Filter for .json files client-side instead.
  let url: string | null =
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/children` +
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
      try {
        const meta = await downloadMeta(id, headers);
        metas.push(meta);
      } catch (err) {
        console.warn('Skipping unreadable metadata:', name, err);
      }
    }

    url = (data['@odata.nextLink'] as string) || null;
  }

  return metas;
}

async function downloadMeta(
  id: string,
  headers: Record<string, string>,
): Promise<OneDriveArticleMeta> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
    { headers },
  );
  if (!res.ok) throw new Error(`Download meta failed: ${res.status}`);
  return res.json();
}

/**
 * Download article HTML content from OneDrive.
 */
export async function downloadArticleHtml(id: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html:/content`,
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
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${meta.id}.json:/content`,
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
    fetch(`${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json`, {
      method: 'DELETE',
      headers,
    }),
    fetch(`${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html`, {
      method: 'DELETE',
      headers,
    }),
    fetch(`${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}`, {
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
    `${GRAPH_BASE}/me/drive/special/approot:/${drivePath}:/content`,
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
    `${GRAPH_BASE}/me/drive/special/approot:/${SETTINGS_PATH}:/content`,
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
    `${GRAPH_BASE}/me/drive/special/approot:/${SETTINGS_PATH}:/content`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) throw new Error(`Upload settings failed: ${res.status}`);
}
