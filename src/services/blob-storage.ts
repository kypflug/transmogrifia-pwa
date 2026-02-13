/**
 * Blob Storage Service for Library of Transmogrifia (PWA)
 *
 * Orchestrates article sharing using pure blob helpers from @kypflug/transmogrifier-core.
 * PWA-specific features: gzip compression, share metadata extraction, share resolution.
 *
 * Flow:
 *  1. Upload article HTML to user's blob container
 *  2. Register short link via cloud function POST /api/share
 *  3. Return branded transmogrifia.app/shared/{code} URL
 */

import { getEffectiveSharingConfig, getEffectiveCloudUrl } from './settings';
import { getAccessToken } from './auth';
import { downloadArticleAsset } from './graph';
import {
  type AzureBlobConfig,
  type ShareResult,
  type OneDriveImageAsset,
  blobUrl,
  blobUrlWithSas,
  deleteHtmlBlob,
  uploadImageBlob,
  imageBlobUrl,
  deleteImageBlobs,
  rewriteTmgAssetUrls,
} from '@kypflug/transmogrifier-core';

export type { AzureBlobConfig, ShareResult } from '@kypflug/transmogrifier-core';

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
 * Compress a string using gzip via the Compression Streams API.
 * Falls back to uncompressed if the API is unavailable.
 */
async function gzipCompress(text: string): Promise<{ body: Blob | string; isCompressed: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    return { body: text, isCompressed: false };
  }
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream).blob();
    return { body: blob, isCompressed: true };
  } catch {
    return { body: text, isCompressed: false };
  }
}

/**
 * Upload article HTML to user's Azure Blob Storage.
 */
async function uploadToBlob(
  html: string,
  articleId: string,
  config: AzureBlobConfig,
): Promise<string> {
  const uploadUrl = blobUrlWithSas(config, articleId);

  // Compress the HTML to reduce transfer size — shared articles with inline
  // data-URL images can be several MB.
  const { body, isCompressed } = await gzipCompress(html);

  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'x-ms-blob-type': 'BlockBlob',
    'x-ms-version': '2024-11-04',
  };
  if (isCompressed) {
    headers['Content-Encoding'] = 'gzip';
  }

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blob upload failed (${response.status}): ${text}`);
  }

  return blobUrl(config, articleId);
}

/**
 * Delete an article blob from storage.
 */
async function deleteFromBlob(
  articleId: string,
  config: AzureBlobConfig,
): Promise<void> {
  return deleteHtmlBlob(articleId, config);
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

// ─── Image Blob Sidecar ──────────────────────────────────────────────────────

/** Max images uploaded concurrently to blob storage */
const IMAGE_UPLOAD_CONCURRENCY = 3;

/**
 * Upload article images to blob storage and rewrite tmg-asset: references
 * in the HTML to direct HTTP blob URLs.
 *
 * For each tmg-asset:{assetId} found in the HTML:
 * 1. Look up the OneDriveImageAsset by ID
 * 2. Download the image from OneDrive
 * 3. Upload to blob storage at {articleId}/images/{fileName}
 * 4. Rewrite src to the public blob URL
 */
async function uploadImagesToBlob(
  html: string,
  articleId: string,
  images: OneDriveImageAsset[],
  config: AzureBlobConfig,
): Promise<string> {
  const assetsById = new Map(images.map(a => [a.id, a]));

  // Find all tmg-asset: references in the HTML
  const tmgPattern = /tmg-asset:([a-f0-9]+)/g;
  const assetIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = tmgPattern.exec(html)) !== null) {
    assetIds.add(match[1]);
  }

  if (assetIds.size === 0) return html;

  // Upload images in batches with concurrency control
  const idArray = Array.from(assetIds);
  const urlMap = new Map<string, string>();

  for (let i = 0; i < idArray.length; i += IMAGE_UPLOAD_CONCURRENCY) {
    const batch = idArray.slice(i, i + IMAGE_UPLOAD_CONCURRENCY);
    await Promise.all(batch.map(async (assetId) => {
      const asset = assetsById.get(assetId);
      if (!asset) return;

      try {
        const blob = await downloadArticleAsset(asset.drivePath);
        const fileName = asset.drivePath.split('/').pop() || `${assetId}.bin`;
        await uploadImageBlob(blob, articleId, fileName, asset.contentType || 'application/octet-stream', config);
        urlMap.set(assetId, imageBlobUrl(config, articleId, fileName));
      } catch (err) {
        console.warn(`[Share] Failed to upload image ${assetId}:`, err);
      }
    }));
  }

  return rewriteTmgAssetUrls(html, urlMap);
}

/**
 * Share an article publicly.
 * Uploads HTML to blob storage and registers a short link.
 * If the article has OneDrive image assets, uploads them as separate blobs
 * and rewrites tmg-asset: references to direct HTTP blob URLs.
 */
export async function shareArticle(
  articleId: string,
  html: string,
  title: string,
  originalUrl: string,
  expiresAt?: number,
  images?: OneDriveImageAsset[],
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

  // 1. Upload image assets to blob storage and rewrite tmg-asset: → HTTP URLs
  let shareHtml = html;
  if (images && images.length > 0) {
    shareHtml = await uploadImagesToBlob(shareHtml, articleId, images, config);
  }

  // 2. Upload article HTML to blob storage
  const resultBlobUrl = await uploadToBlob(shareHtml, articleId, config);

  // 3. Extract metadata for social media preview cards
  const shareMeta = extractShareMeta(shareHtml);

  // 4. Register short link with metadata
  const { shortCode, shareUrl } = await registerShortLink(
    resultBlobUrl,
    title,
    accessToken,
    cloudUrl,
    { description: shareMeta.description, originalUrl, image: shareMeta.image },
    expiresAt,
  );

  return { shareUrl, blobUrl: resultBlobUrl, shortCode };
}

/**
 * Unshare an article.
 * Deletes the blob, image blobs, and the short link.
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
    promises.push(deleteImageBlobs(articleId, config) as Promise<void>);
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
