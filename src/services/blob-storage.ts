/**
 * Blob Storage Service for Library of Transmogrifia (PWA)
 *
 * Uploads/deletes shared article HTML to the user's own Azure Blob Storage account.
 * Uses the Azure Blob REST API with SAS token authentication — no SDK needed.
 *
 * Flow:
 *  1. Upload article HTML to user's blob container
 *  2. Register short link via cloud function POST /api/share
 *  3. Return branded transmogrifia.app/shared/{code} URL
 */

import { getEffectiveSharingConfig, getEffectiveCloudUrl } from './settings';
import { getAccessToken } from './auth';


export interface AzureBlobConfig {
  accountName: string;
  containerName: string;
  sasToken: string;
}

export interface ShareResult {
  shareUrl: string;      // transmogrifia.app/shared/{code}
  blobUrl: string;       // raw blob URL
  shortCode: string;     // short code for unsharing
}

/**
 * Build the blob URL for an article.
 */
function getBlobUrl(config: AzureBlobConfig, articleId: string): string {
  return `https://${config.accountName}.blob.core.windows.net/${config.containerName}/${articleId}.html`;
}

/**
 * Build the SAS-authenticated URL for blob operations.
 */
function getBlobUrlWithSas(config: AzureBlobConfig, articleId: string): string {
  const sasToken = config.sasToken.startsWith('?') ? config.sasToken : `?${config.sasToken}`;
  return `${getBlobUrl(config, articleId)}${sasToken}`;
}

/**
 * Extract metadata from article HTML for social media preview cards.
 * Runs at share-time so the data is stored with the short link.
 */
function extractShareMeta(html: string): { description: string; image?: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Description: og:description > meta description > first <p> text
  const ogDesc = (doc.querySelector('meta[property="og:description"]') as HTMLMetaElement | null)?.content;
  const metaDesc = (doc.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content;
  const firstP = doc.querySelector('p')?.textContent?.trim();
  const rawDesc = ogDesc || metaDesc || firstP || '';
  const description = (rawDesc || 'A transmogrified article — beautiful web content, reimagined.').slice(0, 200);

  // Image: og:image > first <img> with an http(s) src
  const ogImg = (doc.querySelector('meta[property="og:image"]') as HTMLMetaElement | null)?.content;
  const firstImg = doc.querySelector('img[src^="http"]') as HTMLImageElement | null;
  const image = ogImg || firstImg?.src || undefined;

  return { description, image };
}

/**
 * Upload article HTML to user's Azure Blob Storage.
 */
async function uploadToBlob(
  html: string,
  articleId: string,
  config: AzureBlobConfig,
): Promise<string> {
  const uploadUrl = getBlobUrlWithSas(config, articleId);

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2024-11-04',
    },
    body: html,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blob upload failed (${response.status}): ${text}`);
  }

  return getBlobUrl(config, articleId);
}

/**
 * Delete an article blob from storage.
 */
async function deleteFromBlob(
  articleId: string,
  config: AzureBlobConfig,
): Promise<void> {
  const deleteUrl = getBlobUrlWithSas(config, articleId);

  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: {
      'x-ms-version': '2024-11-04',
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Blob delete failed (${response.status}): ${text}`);
  }
}

/** Metadata sent along with short link registration for SSR preview cards. */
interface ShareMeta {
  description: string;
  originalUrl: string;
  image?: string;
}

/**
 * Register a short link via the cloud function.
 */
async function registerShortLink(
  blobUrl: string,
  title: string,
  accessToken: string,
  cloudUrl: string,
  meta: ShareMeta,
  expiresAt?: number,
): Promise<{ shortCode: string; shareUrl: string }> {
  const response = await fetch(`${cloudUrl}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blobUrl,
      title,
      accessToken,
      description: meta.description,
      originalUrl: meta.originalUrl,
      ...(meta.image ? { image: meta.image } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Share registration failed (${response.status})`);
  }

  return response.json() as Promise<{ shortCode: string; shareUrl: string }>;
}

/**
 * Delete a short link via the cloud function.
 */
async function deleteShortLink(
  shortCode: string,
  accessToken: string,
  cloudUrl: string,
): Promise<void> {
  const response = await fetch(`${cloudUrl}/api/share?code=${shortCode}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Short link deletion failed (${response.status})`);
  }
}

/**
 * Share an article publicly.
 * Uploads HTML to blob storage and registers a short link.
 */
export async function shareArticle(
  articleId: string,
  html: string,
  title: string,
  originalUrl: string,
  expiresAt?: number,
): Promise<ShareResult> {
  const config = await getEffectiveSharingConfig();
  if (!config) {
    throw new Error('Sharing not configured. Go to Settings to set up Azure Blob Storage.');
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Sign in to share articles.');
  }

  const cloudUrl = await getEffectiveCloudUrl();

  // 1. Upload article HTML to blob storage
  const blobUrl = await uploadToBlob(html, articleId, config);

  // 2. Extract metadata for social media preview cards
  const shareMeta = extractShareMeta(html);

  // 3. Register short link with metadata
  const { shortCode, shareUrl } = await registerShortLink(
    blobUrl,
    title,
    accessToken,
    cloudUrl,
    { description: shareMeta.description, originalUrl, image: shareMeta.image },
    expiresAt,
  );

  return { shareUrl, blobUrl, shortCode };
}

/**
 * Unshare an article.
 * Deletes the blob and the short link.
 */
export async function unshareArticle(
  articleId: string,
  shortCode: string,
): Promise<void> {
  const config = await getEffectiveSharingConfig();
  const accessToken = await getAccessToken();
  const cloudUrl = await getEffectiveCloudUrl();

  const promises: Promise<void>[] = [];

  if (config) {
    promises.push(deleteFromBlob(articleId, config));
  }

  if (accessToken && shortCode) {
    promises.push(deleteShortLink(shortCode, accessToken, cloudUrl));
  }

  await Promise.allSettled(promises);
}

/**
 * Resolve a share short code to a blob URL and title.
 * Used by the shared article viewer — no auth required.
 */
/** Shape returned by the share code resolution API. */
export interface ResolvedShare {
  url: string;
  title: string;
  description?: string;
  originalUrl?: string;
  image?: string;
}

export async function resolveShareCode(
  code: string,
  cloudUrl?: string,
): Promise<ResolvedShare> {
  const baseUrl = cloudUrl || 'https://transmogrifier-api.azurewebsites.net';

  const response = await fetch(`${baseUrl}/api/s/${code}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('This shared link has expired or been removed.');
    }
    throw new Error(`Failed to resolve share link (${response.status})`);
  }

  return response.json() as Promise<ResolvedShare>;
}
