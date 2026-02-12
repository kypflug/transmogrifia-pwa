/**
 * Shared Article Viewer
 *
 * Renders a transmogrified article from a public share link.
 * No authentication required — fetches the article HTML from
 * the user's blob storage via the short link resolver.
 *
 * URL format: transmogrifia.app/shared/{10-char-code}
 */

import { resolveShareCode } from '../services/blob-storage';
import type { ResolvedShare } from '../services/blob-storage';

/** Inject / update OG meta tags in the host document head. */
function setDocumentMeta(title: string, description?: string, image?: string, url?: string): void {
  const setMeta = (attr: string, key: string, content: string) => {
    let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.content = content;
  };

  const pageUrl = url || window.location.href;
  const desc = description || 'A transmogrified article — beautiful web content, reimagined.';

  // OpenGraph
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', desc);
  setMeta('property', 'og:url', pageUrl);
  setMeta('property', 'og:type', 'article');
  setMeta('property', 'og:site_name', 'Library of Transmogrifia');

  // Twitter Card
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', desc);

  if (image) {
    setMeta('property', 'og:image', image);
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:image', image);
  } else {
    setMeta('name', 'twitter:card', 'summary');
  }

  // Standard meta description
  setMeta('name', 'description', desc);
}

/**
 * Render the shared article viewer into the given container.
 * Bypasses the normal auth gate entirely.
 */
export async function renderSharedViewer(
  container: HTMLElement,
  shortCode: string,
): Promise<void> {
  // Show loading state
  container.innerHTML = `
    <div class="shared-viewer">
      <div class="shared-viewer-chrome">
        <a class="shared-viewer-brand" href="https://transmogrifia.app">
          <img src="/icons/icon-64.png" alt="" width="24" height="24">
          <span>Transmogrifia</span>
        </a>
      </div>
      <div class="shared-viewer-loading" id="sharedLoading">
        <div class="shared-viewer-spinner"></div>
        <p>Loading shared article…</p>
      </div>
      <iframe
        id="sharedFrame"
        class="shared-viewer-frame"
        sandbox="allow-same-origin allow-popups"
        style="display:none"
      ></iframe>
    </div>
  `;

  try {
    // 1. Resolve the short code — returns title, blob URL, and preview metadata
    const resolved: ResolvedShare = await resolveShareCode(shortCode);
    const { url, title, description, originalUrl, image } = resolved;

    // 2. Fetch the article HTML from blob storage (public, no auth)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load article (${response.status})`);
    }
    const html = await response.text();

    // Update page title & social meta tags (client-side fallback)
    document.title = `${title} — Library of Transmogrifia`;
    setDocumentMeta(title, description, image);

    // 3. Render in sandboxed iframe
    const loading = document.getElementById('sharedLoading');
    const frame = document.getElementById('sharedFrame') as HTMLIFrameElement | null;
    if (!frame) return;

    // Inject <base> so relative URLs (images, links) resolve against the
    // original article's site, not the PWA's origin.
    let baseTag = '';
    if (originalUrl) {
      try {
        const base = new URL(originalUrl);
        base.hash = '';
        base.search = '';
        baseTag = `<base href="${base.href}">`;
      } catch { /* invalid URL — skip */ }
    }

    // Inject style overrides to hide the save FAB and fix viewport
    const styleOverride = `
      ${baseTag}
      <style>
        .remix-save-fab { display: none !important; }
        html, body { overflow-x: hidden; max-width: 100vw; height: auto !important; }
        /* Force JS-driven animation classes to visible state (scripts blocked by sandbox) */
        .io, .reveal, .cap { opacity: 1 !important; transform: none !important; }
      </style>
    `;
    const htmlWithOverrides = html.includes('</head>')
      ? html.replace('</head>', `${styleOverride}</head>`)
      : styleOverride + html;

    frame.srcdoc = htmlWithOverrides;
    frame.addEventListener('load', () => {
      if (loading) loading.style.display = 'none';
      frame.style.display = 'block';

      // Fix links to open in new tab
      const doc = frame.contentDocument;
      if (doc) {
        doc.querySelectorAll('a[href]').forEach(a => {
          (a as HTMLAnchorElement).target = '_blank';
          (a as HTMLAnchorElement).rel = 'noopener';
        });
      }
    });

    // Update the chrome bar with title and original URL globe button
    const chrome = container.querySelector('.shared-viewer-chrome');
    if (chrome) {
      const globeBtn = originalUrl
        ? `<a class="shared-viewer-orig-btn" href="${escapeAttr(originalUrl)}" target="_blank" rel="noopener" title="Open original article">🌐</a>`
        : '';
      chrome.innerHTML = `
        <a class="shared-viewer-brand" href="https://transmogrifia.app">
          <img src="/icons/icon-64.png" alt="" width="24" height="24">
          <span>Transmogrifia</span>
        </a>
        <div class="shared-viewer-title">${escapeHtml(title)}</div>
        ${globeBtn}
      `;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    container.innerHTML = `
      <div class="shared-viewer">
        <div class="shared-viewer-chrome">
          <a class="shared-viewer-brand" href="https://transmogrifia.app">
            <img src="/icons/icon-64.png" alt="" width="24" height="24">
            <span>Transmogrifia</span>
          </a>
        </div>
        <div class="shared-viewer-error">
          <p class="shared-viewer-error-icon">🔗</p>
          <h2>Link not available</h2>
          <p>${escapeHtml(message)}</p>
          <a href="/" class="shared-viewer-home-link">Go to Library of Transmogrifia</a>
        </div>
      </div>
    `;
  }
}

function escapeHtml(text: string): string {
  const el = document.createElement('span');
  el.textContent = text;
  return el.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
