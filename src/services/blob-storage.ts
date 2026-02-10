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
 * Inject OpenGraph meta tags into the article HTML for social media previews.
 */
function injectOGTags(html: string, title: string, shareUrl: string): string {
  const description = 'A transmogrified article — beautiful web content, reimagined.';

  const ogTags = `
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(description)}">
    <meta property="og:url" content="${escapeAttr(shareUrl)}">
    <meta property="og:type" content="article">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${escapeAttr(title)}">
    <meta name="twitter:description" content="${escapeAttr(description)}">
  `;

  if (html.includes('</head>')) {
    return html.replace('</head>', `${ogTags}</head>`);
  } else if (html.includes('<head>')) {
    return html.replace('<head>', `<head>${ogTags}`);
  }
  return ogTags + html;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/**
 * Register a short link via the cloud function.
 */
async function registerShortLink(
  blobUrl: string,
  title: string,
  accessToken: string,
  cloudUrl: string,
  expiresAt?: number,
): Promise<{ shortCode: string; shareUrl: string }> {
  const response = await fetch(`${cloudUrl}/api/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blobUrl,
      title,
      accessToken,
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

  // 1. Inject OG tags and upload to blob
  const shareUrlPlaceholder = `${window.location.origin}/shared/`;
  const htmlWithOG = injectOGTags(html, title, shareUrlPlaceholder);
  const blobUrl = await uploadToBlob(htmlWithOG, articleId, config);

  // 2. Register short link
  const { shortCode, shareUrl } = await registerShortLink(
    blobUrl,
    title,
    accessToken,
    cloudUrl,
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
export async function resolveShareCode(
  code: string,
  cloudUrl?: string,
): Promise<{ url: string; title: string }> {
  const baseUrl = cloudUrl || 'https://transmogrifier-api.azurewebsites.net';

  const response = await fetch(`${baseUrl}/api/s/${code}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('This shared link has expired or been removed.');
    }
    throw new Error(`Failed to resolve share link (${response.status})`);
  }

  return response.json() as Promise<{ url: string; title: string }>;
}
