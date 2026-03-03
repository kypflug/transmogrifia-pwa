/**
 * Storage facade — delegates every call to the active storage provider
 * obtained from the provider registry. Consumers import from this module
 * and remain unaware of whether Microsoft OneDrive or Google Drive is
 * backing the storage layer.
 */

import { getStorage } from './providers/registry';
import type { OneDriveArticleMeta, UserProfile } from '../types';
import type { SyncEncryptedEnvelope } from './crypto';

// Re-export types that consumers depend on
export type { DeltaSyncResult, BootstrapResult, CloudSettingsFile } from './providers/types';

// Re-export error utilities (used by sync-coordinator and library)
export { GraphHttpError, isGraphGoneError } from './providers/microsoft/storage';

export async function syncArticles() {
  return getStorage().syncArticles();
}

export async function clearDeltaToken(): Promise<void> {
  return getStorage().clearDeltaToken();
}

export async function rebuildIndex(articles: OneDriveArticleMeta[]): Promise<void> {
  return getStorage().rebuildIndex(articles);
}

export async function bootstrapDeltaToken(knownIds: Set<string>) {
  return getStorage().bootstrapDeltaToken(knownIds);
}

export async function listArticles() {
  return getStorage().listArticles();
}

export async function downloadArticleHtml(id: string): Promise<string> {
  return getStorage().downloadArticleHtml(id);
}

export async function uploadMeta(
  meta: OneDriveArticleMeta,
  mergeFn?: (local: OneDriveArticleMeta, remote: OneDriveArticleMeta) => OneDriveArticleMeta,
): Promise<void> {
  return getStorage().uploadMeta(meta, mergeFn);
}

export async function deleteArticle(id: string): Promise<void> {
  return getStorage().deleteArticle(id);
}

export async function downloadArticleAsset(drivePath: string): Promise<Blob> {
  return getStorage().downloadArticleAsset(drivePath);
}

export async function hasDeltaToken(): Promise<boolean> {
  return getStorage().hasDeltaToken();
}

export async function getUserProfile(): Promise<UserProfile> {
  return getStorage().getUserProfile();
}

export async function downloadSettings() {
  return getStorage().downloadSettings();
}

export async function uploadSettings(envelope: SyncEncryptedEnvelope, updatedAt: number, syncVersion?: number): Promise<void> {
  return getStorage().uploadSettings(envelope, updatedAt, syncVersion);
}
