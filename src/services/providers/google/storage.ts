/**
 * Google Drive Storage Provider for Library of Transmogrifia
 *
 * Implements the StorageProvider interface using Google Drive REST API v3
 * with the appDataFolder special folder. File-ID-based access is managed
 * via an in-memory filename → fileId cache populated on first sync.
 */

import type { OneDriveArticleMeta, UserProfile } from '../../../types';
import type { SyncEncryptedEnvelope } from '../../crypto';
import type {
  StorageProvider,
  DeltaSyncResult,
  BootstrapResult,
  CloudSettingsFile,
} from '../types';
import { getSettingsValue, setSettingsValue, removeSettingsValue } from '../../cache';
import { safeGetItem, safeRemoveItem } from '../../../utils/storage';

// ─── Constants ──────────────────────────────────────────────────────

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DELTA_TOKEN_KEY = 'transmogrifia_gdrive_change_token';
const DELTA_TOKEN_LS_KEY = 'transmogrifia_gdrive_change_token';
const METADATA_CONCURRENCY = 6;
const INDEX_FILE = '_index.json';
const SETTINGS_FILE = 'settings.enc.json';

// ─── Article index shape ────────────────────────────────────────────

interface ArticleIndex {
  version: 1;
  updatedAt: number;
  articles: OneDriveArticleMeta[];
}

// ─── Google Drive change response types ─────────────────────────────

interface GDriveFile {
  id: string;
  name: string;
}

interface GDriveChange {
  removed?: boolean;
  fileId: string;
  file?: GDriveFile;
}

interface GDriveChangesResponse {
  nextPageToken?: string;
  newStartPageToken?: string;
  changes: GDriveChange[];
}

// ─── Provider implementation ────────────────────────────────────────

export class GoogleDriveStorageProvider implements StorageProvider {
  readonly type = 'google' as const;

  private fileIdCache = new Map<string, string>();
  private fileIdCacheLoaded = false;

  constructor(private getAccessToken: () => Promise<string>) {}

  // ─── Private helpers ────────────────────────────────────────────

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  private async ensureFileIdCache(): Promise<void> {
    if (!this.fileIdCacheLoaded) {
      await this.listAllFiles();
      this.fileIdCacheLoaded = true;
    }
  }

  private async listAllFiles(): Promise<void> {
    const headers = await this.authHeaders();
    let pageToken: string | undefined;
    this.fileIdCache.clear();

    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`${DRIVE_BASE}/files?${params}`, { headers });
      if (!res.ok) throw new Error(`[GDrive] List files failed: ${res.status}`);

      const data: { nextPageToken?: string; files?: GDriveFile[] } = await res.json();
      for (const file of data.files ?? []) {
        this.fileIdCache.set(file.name, file.id);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  private getFileId(name: string): string | undefined {
    return this.fileIdCache.get(name);
  }

  private async downloadFileContent(fileId: string): Promise<Response> {
    const headers = await this.authHeaders();
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
      headers,
      cache: 'no-store',
    });
    return res;
  }

  private async uploadFile(
    name: string,
    content: string,
    mimeType: string,
    existingFileId?: string,
  ): Promise<GDriveFile> {
    const headers = await this.authHeaders();
    const boundary = 'transmogrifia_boundary';
    const metadata = existingFileId
      ? {}
      : { name, parents: ['appDataFolder'] };

    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const url = existingFileId
      ? `${DRIVE_UPLOAD}/files/${existingFileId}?uploadType=multipart`
      : `${DRIVE_UPLOAD}/files?uploadType=multipart`;

    const res = await fetch(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) throw new Error(`[GDrive] Upload file "${name}" failed: ${res.status}`);

    const result: GDriveFile = await res.json();

    // Cache the new file ID on create
    if (!existingFileId && result.id) {
      this.fileIdCache.set(name, result.id);
    }

    return result;
  }

  private async deleteFile(fileId: string): Promise<void> {
    const headers = await this.authHeaders();
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers,
    });
    // 404 is acceptable — file may already be deleted
    if (!res.ok && res.status !== 404) {
      throw new Error(`[GDrive] Delete file failed: ${res.status}`);
    }
  }

  // ─── Delta token persistence (IndexedDB with localStorage migration) ──

  private async getDeltaToken(): Promise<string | null> {
    const idbToken = await getSettingsValue<string>(DELTA_TOKEN_KEY);
    if (idbToken) return idbToken;

    const lsToken = safeGetItem(DELTA_TOKEN_LS_KEY);
    if (lsToken) {
      console.debug('[GDrive] Migrating change token from localStorage to IndexedDB');
      await setSettingsValue(DELTA_TOKEN_KEY, lsToken);
      safeRemoveItem(DELTA_TOKEN_LS_KEY);
      return lsToken;
    }

    return null;
  }

  private async saveDeltaToken(token: string): Promise<void> {
    await setSettingsValue(DELTA_TOKEN_KEY, token);
  }

  private async removeDeltaToken(): Promise<void> {
    await removeSettingsValue(DELTA_TOKEN_KEY);
    safeRemoveItem(DELTA_TOKEN_LS_KEY);
  }

  // ─── Index helpers ────────────────────────────────────────────────

  private async downloadIndex(): Promise<OneDriveArticleMeta[] | null> {
    try {
      await this.ensureFileIdCache();
      const fileId = this.getFileId(INDEX_FILE);
      if (!fileId) return null;

      const res = await this.downloadFileContent(fileId);
      if (res.status === 404) return null;
      if (!res.ok) return null;

      const data: ArticleIndex = await res.json();
      if (data.version !== 1 || !Array.isArray(data.articles)) return null;
      return data.articles;
    } catch {
      return null;
    }
  }

  private async uploadIndex(articles: OneDriveArticleMeta[]): Promise<void> {
    const index: ArticleIndex = {
      version: 1,
      updatedAt: Date.now(),
      articles,
    };
    const existingId = this.getFileId(INDEX_FILE);
    await this.uploadFile(
      INDEX_FILE,
      JSON.stringify(index),
      'application/json',
      existingId,
    );
  }

  // ─── Metadata batch download ──────────────────────────────────────

  private async downloadMetaBatch(
    items: Array<{ id: string; fileId: string }>,
  ): Promise<{ metas: OneDriveArticleMeta[]; failureCount: number; deletedDuringDownload: string[] }> {
    const metas: OneDriveArticleMeta[] = [];
    let failureCount = 0;
    const deletedDuringDownload: string[] = [];

    for (let i = 0; i < items.length; i += METADATA_CONCURRENCY) {
      const batch = items.slice(i, i + METADATA_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const res = await this.downloadFileContent(item.fileId);
          if (res.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
          if (!res.ok) throw new Error(`Download meta failed: ${res.status}`);
          return res.json() as Promise<OneDriveArticleMeta>;
        }),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          metas.push(result.value);
        } else {
          const err = result.reason as { status?: number };
          if (err.status === 404) {
            deletedDuringDownload.push(batch[j].id);
          } else {
            console.warn('[GDrive] Metadata download failed:', result.reason);
            failureCount++;
          }
        }
      }
    }

    return { metas, failureCount, deletedDuringDownload: [...new Set(deletedDuringDownload)] };
  }

  // ─── Public StorageProvider methods ───────────────────────────────

  async syncArticles(): Promise<DeltaSyncResult> {
    const savedToken = await this.getDeltaToken();
    const isFullSync = !savedToken;

    // For full syncs, try the fast index path first
    if (isFullSync) {
      const indexMetas = await this.downloadIndex();
      if (indexMetas !== null) {
        return { upserted: indexMetas, deleted: [], fullSync: true, usedIndex: true };
      }
    }

    // Incremental sync via Changes API
    if (savedToken) {
      return this.syncViaChanges(savedToken);
    }

    // No index, no token — full list
    const allMeta = await this.listArticles();
    return { upserted: allMeta, deleted: [], fullSync: true, usedIndex: false };
  }

  private async syncViaChanges(pageToken: string): Promise<DeltaSyncResult> {
    const headers = await this.authHeaders();
    let currentPageToken: string | null = pageToken;
    const upsertedIds = new Map<string, string>(); // id → fileId
    const deleted: string[] = [];
    let newStartPageToken: string | null = null;
    let hasDownloadFailures = false;

    try {
      while (currentPageToken) {
        const params = new URLSearchParams({
          pageToken: currentPageToken,
          spaces: 'appDataFolder',
          fields: 'nextPageToken,newStartPageToken,changes(removed,fileId,file(id,name))',
        });

        const res = await fetch(`${DRIVE_BASE}/changes?${params}`, { headers, cache: 'no-store' });

        if (!res.ok) {
          if (res.status === 404 || res.status === 410) {
            // Token expired — fall back to full list
            await this.removeDeltaToken();
            const allMeta = await this.listArticles();
            return { upserted: allMeta, deleted: [], fullSync: true, usedIndex: false };
          }
          throw new Error(`[GDrive] Changes sync failed: ${res.status}`);
        }

        const data: GDriveChangesResponse = await res.json();

        for (const change of data.changes) {
          if (change.removed || !change.file) {
            // File removed — figure out the name from our cache
            const name = this.findNameByFileId(change.fileId);
            if (name) {
              const articleId = this.extractArticleId(name);
              if (articleId) deleted.push(articleId);
              this.fileIdCache.delete(name);
            }
            continue;
          }

          const name = change.file.name;
          // Update file ID cache
          this.fileIdCache.set(name, change.file.id);

          if (!name.endsWith('.json')) continue;
          if (name.startsWith('_') || name === SETTINGS_FILE) continue;

          const id = name.replace('.json', '');
          upsertedIds.set(id, change.file.id);
        }

        if (data.newStartPageToken) {
          newStartPageToken = data.newStartPageToken;
          currentPageToken = null;
        } else {
          currentPageToken = data.nextPageToken ?? null;
        }
      }
    } catch (err) {
      if (pageToken) await this.removeDeltaToken();
      throw err;
    }

    // Download metadata for upserted articles
    const upserted: OneDriveArticleMeta[] = [];
    if (upsertedIds.size > 0) {
      const toDownload = Array.from(upsertedIds.entries()).map(([id, fileId]) => ({ id, fileId }));
      const { metas, failureCount, deletedDuringDownload } = await this.downloadMetaBatch(toDownload);
      upserted.push(...metas);
      deleted.push(...deletedDuringDownload);
      hasDownloadFailures = failureCount > 0;
    }

    // Only persist the token if all downloads succeeded
    if (newStartPageToken) {
      if (!hasDownloadFailures) {
        await this.saveDeltaToken(newStartPageToken);
      } else {
        console.warn('[GDrive] Change token not saved — some metadata downloads failed');
      }
    }

    const uniqueDeleted = [...new Set(deleted)];
    return { upserted, deleted: uniqueDeleted, fullSync: false, usedIndex: false };
  }

  private findNameByFileId(fileId: string): string | undefined {
    for (const [name, id] of this.fileIdCache) {
      if (id === fileId) return name;
    }
    return undefined;
  }

  private extractArticleId(name: string): string | null {
    if (name.startsWith('_')) return null;
    if (name === SETTINGS_FILE) return null;
    if (name.endsWith('.json')) return name.replace('.json', '');
    if (name.endsWith('.html')) return name.replace('.html', '');
    return null;
  }

  async listArticles(): Promise<OneDriveArticleMeta[]> {
    await this.ensureFileIdCache();

    const toDownload: Array<{ id: string; fileId: string }> = [];
    for (const [name, fileId] of this.fileIdCache) {
      if (!name.endsWith('.json')) continue;
      if (name.startsWith('_') || name === SETTINGS_FILE) continue;
      const id = name.replace('.json', '');
      toDownload.push({ id, fileId });
    }

    const { metas } = await this.downloadMetaBatch(toDownload);
    return metas;
  }

  async downloadArticleHtml(id: string): Promise<string> {
    await this.ensureFileIdCache();
    const fileName = `${id}.html`;
    const fileId = this.getFileId(fileName);
    if (!fileId) throw new Error(`[GDrive] HTML file not found: ${fileName}`);

    const res = await this.downloadFileContent(fileId);
    if (!res.ok) throw new Error(`[GDrive] Download HTML failed: ${res.status}`);
    return res.text();
  }

  async uploadMeta(
    meta: OneDriveArticleMeta,
    _mergeFn?: (local: OneDriveArticleMeta, remote: OneDriveArticleMeta) => OneDriveArticleMeta,
  ): Promise<void> {
    await this.ensureFileIdCache();
    const fileName = `${meta.id}.json`;
    const existingId = this.getFileId(fileName);

    await this.uploadFile(
      fileName,
      JSON.stringify(meta, null, 2),
      'application/json',
      existingId,
    );
  }

  async deleteArticle(id: string): Promise<void> {
    await this.ensureFileIdCache();

    // Collect all files belonging to this article
    const filesToDelete: Array<{ name: string; fileId: string }> = [];
    for (const [name, fileId] of this.fileIdCache) {
      if (
        name === `${id}.json` ||
        name === `${id}.html` ||
        name.startsWith(`${id}/`)
      ) {
        filesToDelete.push({ name, fileId });
      }
    }

    // Delete all in parallel
    const results = await Promise.allSettled(
      filesToDelete.map(f => this.deleteFile(f.fileId)),
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[GDrive] Delete article file failed:', r.reason);
      }
    }

    // Remove from cache
    for (const f of filesToDelete) {
      this.fileIdCache.delete(f.name);
    }
  }

  async downloadArticleAsset(path: string): Promise<Blob> {
    await this.ensureFileIdCache();
    const fileId = this.getFileId(path);
    if (!fileId) throw new Error(`[GDrive] Asset not found: ${path}`);

    const res = await this.downloadFileContent(fileId);
    if (!res.ok) throw new Error(`[GDrive] Download asset failed: ${res.status}`);
    return res.blob();
  }

  async rebuildIndex(articles: OneDriveArticleMeta[]): Promise<void> {
    try {
      await this.ensureFileIdCache();
      await this.uploadIndex(articles);
    } catch (err) {
      console.warn('[GDrive] Failed to rebuild index:', err);
    }
  }

  async bootstrapDeltaToken(knownIds: Set<string>): Promise<BootstrapResult> {
    const headers = await this.authHeaders();

    // Get initial startPageToken
    const tokenRes = await fetch(
      `${DRIVE_BASE}/changes/startPageToken?${new URLSearchParams({ spaces: 'appDataFolder' })}`,
      { headers },
    );
    if (!tokenRes.ok) throw new Error(`[GDrive] Get startPageToken failed: ${tokenRes.status}`);
    const { startPageToken } = await tokenRes.json() as { startPageToken: string };

    // List all files and find any not in knownIds
    await this.listAllFiles();
    this.fileIdCacheLoaded = true;

    const toDownload: Array<{ id: string; fileId: string }> = [];
    const allCurrentIds = new Set<string>();

    for (const [name, fileId] of this.fileIdCache) {
      if (!name.endsWith('.json')) continue;
      if (name.startsWith('_') || name === SETTINGS_FILE) continue;
      const id = name.replace('.json', '');
      allCurrentIds.add(id);
      if (!knownIds.has(id)) {
        toDownload.push({ id, fileId });
      }
    }

    // Find articles that were deleted since the index was built
    const deletedIds: string[] = [];
    for (const id of knownIds) {
      if (!allCurrentIds.has(id)) {
        deletedIds.push(id);
      }
    }

    // Download metadata for new articles
    let newMetas: OneDriveArticleMeta[] = [];
    let hasDownloadFailures = false;
    if (toDownload.length > 0) {
      const { metas, failureCount, deletedDuringDownload } = await this.downloadMetaBatch(toDownload);
      newMetas = metas;
      deletedIds.push(...deletedDuringDownload.filter(id => knownIds.has(id)));
      hasDownloadFailures = failureCount > 0;
    }

    // Only save the token if all downloads succeeded
    if (!hasDownloadFailures) {
      await this.saveDeltaToken(startPageToken);
      console.debug('[GDrive] Bootstrap change token saved');
    } else {
      console.warn('[GDrive] Bootstrap change token NOT saved — some metadata downloads failed');
    }

    return { newMetas, deletedIds: [...new Set(deletedIds)] };
  }

  async clearDeltaToken(): Promise<void> {
    await this.removeDeltaToken();
  }

  async hasDeltaToken(): Promise<boolean> {
    const token = await this.getDeltaToken();
    return !!token;
  }

  async downloadSettings(): Promise<CloudSettingsFile | null> {
    await this.ensureFileIdCache();
    const fileId = this.getFileId(SETTINGS_FILE);
    if (!fileId) return null;

    const res = await this.downloadFileContent(fileId);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`[GDrive] Download settings failed: ${res.status}`);
    return res.json() as Promise<CloudSettingsFile>;
  }

  async uploadSettings(
    envelope: SyncEncryptedEnvelope,
    updatedAt: number,
    syncVersion?: number,
  ): Promise<void> {
    await this.ensureFileIdCache();
    const payload: CloudSettingsFile = { envelope, updatedAt };
    if (syncVersion != null) payload.syncVersion = syncVersion;

    const existingId = this.getFileId(SETTINGS_FILE);
    await this.uploadFile(
      SETTINGS_FILE,
      JSON.stringify(payload),
      'application/json',
      existingId,
    );
  }

  async getUserProfile(): Promise<UserProfile> {
    const headers = await this.authHeaders();
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`[GDrive] Failed to fetch profile: ${res.status}`);

    const data: { name?: string; email?: string } = await res.json();
    return {
      displayName: data.name ?? '',
      mail: data.email ?? null,
      userPrincipalName: data.email ?? '',
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────

export function createGoogleDriveStorage(
  getAccessToken: () => Promise<string>,
): GoogleDriveStorageProvider {
  return new GoogleDriveStorageProvider(getAccessToken);
}
