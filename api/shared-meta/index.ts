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
 *  3. Resolves the code via the cloud API — returns title, description,
 *     image, and originalUrl (stored at share-creation time)
 *  4. Fetches the production index.html and injects OG tags + updated title
 *     so the SPA boots normally with correct asset hashes
 *
 * Two outbound fetches: one to resolve the share code, one to get index.html.
 * The index.html fetch is cached in memory to avoid repeated requests.
 */

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';

const CLOUD_API = 'https://transmogrifier-api.azurewebsites.net';

/** Shape returned by GET /api/s/{code}. */
interface ResolvedShare {
  url: string;
  title: string;
  description?: string;
  originalUrl?: string;
  image?: string;
}

/** Cached index.html content (stays in memory for the function instance). */
let cachedIndexHtml: string | null = null;

/** Extract the short code from the original request URL. */
function extractCode(req: HttpRequest): string | null {
  const originalUrl = req.headers.get('x-ms-original-url') || req.url;
  const match = originalUrl.match(/\/shared\/([A-Za-z0-9]{6,20})(?:[?#]|$)/);
  return match?.[1] ?? null;
}

/** Get the origin from the request (for fetching index.html). */
function getOrigin(req: HttpRequest): string {
  const originalUrl = req.headers.get('x-ms-original-url') || req.url;
  return new URL(originalUrl).origin;
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

/**
 * Fetch the production index.html from the SWA origin.
 * Cached in memory — the HTML only changes on deploy (which restarts the function).
 */
async function getIndexHtml(origin: string): Promise<string | null> {
  if (cachedIndexHtml) return cachedIndexHtml;
  try {
    const res = await fetch(`${origin}/index.html`);
    if (!res.ok) return null;
    cachedIndexHtml = await res.text();
    return cachedIndexHtml;
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
 * Inject OG meta tags and update the <title> in the production index.html.
 * Falls back to returning index.html unmodified if no share metadata.
 */
function injectMetaTags(
  html: string,
  opts: { title?: string; description?: string; image?: string; pageUrl?: string },
): string {
  if (!opts.title) return html;

  const title = opts.title;
  const desc = opts.description ?? DEFAULT_DESC;
  const pageUrl = opts.pageUrl ?? '';
  const twitterCard = opts.image ? 'summary_large_image' : 'summary';

  const ogTags = `
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
    <meta name="twitter:description" content="${escapeAttr(desc)}">
    <meta name="description" content="${escapeAttr(desc)}">`;

  const displayTitle = `${escapeAttr(title)} — Library of Transmogrifia`;

  // Inject OG tags before </head>
  let result = html.replace('</head>', `${ogTags}\n</head>`);

  // Replace <title>
  result = result.replace(/<title>[^<]*<\/title>/, `<title>${displayTitle}</title>`);

  // Replace meta description if one exists
  result = result.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeAttr(desc)}">`,
  );

  return result;
}

async function handler(
  req: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  const code = extractCode(req);
  const origin = getOrigin(req);

  // Fetch the production index.html (with correct asset hashes)
  const indexHtml = await getIndexHtml(origin);
  if (!indexHtml) {
    // If we can't fetch index.html, redirect to the page and let SWA serve it
    return {
      status: 302,
      headers: { Location: `${origin}/shared/${code || ''}` },
    };
  }

  // No valid code — serve plain index.html, SPA handles error state
  if (!code) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: indexHtml,
    };
  }

  // Resolve the share code (single outbound fetch)
  const resolved = await resolveShareCode(code);

  if (!resolved) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: indexHtml,
    };
  }

  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: injectMetaTags(indexHtml, {
      title: resolved.title,
      description: resolved.description,
      image: resolved.image,
      pageUrl: `${origin}/shared/${code}`,
    }),
  };
}

app.http('shared-meta', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'shared-meta',
  handler,
});
