/**
 * Azure Function: Shared Article SSR
 *
 * Serves /shared/{code} requests with pre-rendered OpenGraph meta tags
 * so social media crawlers (Twitter/X, Facebook, LinkedIn, etc.) can
 * generate rich preview cards without executing JavaScript.
 *
 * How it works:
 *  1. SWA routes /shared/* → /api/shared-meta (see staticwebapp.config.json)
 *  2. This function extracts the share code from x-ms-original-url
 *  3. Resolves the code via the cloud API — now returns title, description,
 *     image, and originalUrl (stored at share-creation time)
 *  4. Returns an HTML page with OG tags + the SPA bootstrap script
 *
 * Only ONE outbound fetch (the resolve call). No article HTML download,
 * no self-fetch of index.html.
 */

import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

const CLOUD_API = 'https://transmogrifier-api.azurewebsites.net';

/** Shape returned by GET /api/s/{code}. */
interface ResolvedShare {
  url: string;
  title: string;
  description?: string;
  originalUrl?: string;
  image?: string;
}

/** Extract the short code from the original request URL. */
function extractCode(req: HttpRequest): string | null {
  const originalUrl = req.headers.get('x-ms-original-url') || req.url;
  const match = originalUrl.match(/\/shared\/([A-Za-z0-9]{6,20})(?:[?#]|$)/);
  return match?.[1] ?? null;
}

/** Resolve a share short code via the cloud API. */
async function resolveShareCode(code: string): Promise<ResolvedShare | null> {
  try {
    const res = await fetch(`${CLOUD_API}/api/s/${code}`);
    if (!res.ok) return null;
    return (await res.json()) as ResolvedShare;
  } catch {
    return null;
  }
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const DEFAULT_DESC = 'A transmogrified article — beautiful web content, reimagined.';

/**
 * Build the full HTML page.
 *
 * Uses a self-contained inline template rather than fetching the app's
 * index.html — avoids an extra network round-trip and the index.html
 * changes rarely enough that keeping this in sync is trivial.
 *
 * The SPA's main.ts boots normally and renders the shared viewer.
 */
function buildPage(opts: {
  title?: string;
  description?: string;
  image?: string;
  pageUrl?: string;
}): string {
  const title = opts.title ?? 'Library of Transmogrifia';
  const desc = opts.description ?? DEFAULT_DESC;
  const pageUrl = opts.pageUrl ?? '';
  const twitterCard = opts.image ? 'summary_large_image' : 'summary';

  const ogBlock = opts.title
    ? `
    <!-- Social media preview (SSR-injected) -->
    <meta property="og:title" content="${escapeAttr(title)}">
    <meta property="og:description" content="${escapeAttr(desc)}">
    <meta property="og:url" content="${escapeAttr(pageUrl)}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="Library of Transmogrifia">${
      opts.image
        ? `\n    <meta property="og:image" content="${escapeAttr(opts.image)}">\n    <meta name="twitter:image" content="${escapeAttr(opts.image)}">`
        : ''
    }
    <meta name="twitter:card" content="${twitterCard}">
    <meta name="twitter:title" content="${escapeAttr(title)}">
    <meta name="twitter:description" content="${escapeAttr(desc)}">`
    : '';

  const displayTitle = opts.title ? `${escapeAttr(title)} — Library of Transmogrifia` : 'Library of Transmogrifia';

  // Keep in sync with index.html — only the meta tags and <title> differ
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0078D4">
  <meta name="description" content="${escapeAttr(desc)}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">${ogBlock}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <title>${displayTitle}</title>
  <link rel="stylesheet" href="/src/styles/global.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>`;
}

export default async function handler(
  req: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const code = extractCode(req);
  const originalUrl = req.headers.get('x-ms-original-url') || req.url;
  const origin = new URL(originalUrl).origin;

  // Invalid code — serve plain page, SPA handles error state
  if (!code) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: buildPage({}),
    };
  }

  // Resolve the share code (single outbound fetch)
  const resolved = await resolveShareCode(code);

  if (!resolved) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: buildPage({}),
    };
  }

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: buildPage({
      title: resolved.title,
      description: resolved.description,
      image: resolved.image,
      pageUrl: `${origin}/shared/${code}`,
    }),
  };
}
