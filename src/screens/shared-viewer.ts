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
import { attachLightbox } from '@kypflug/transmogrifier-core';

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

/** Return the fragment for same-document anchor links; otherwise null. */
function getSameDocumentAnchorFragment(doc: Document, href: string): string | null {
  if (!href || href === '#') return null;
  if (href.startsWith('#')) return href.slice(1);
  if (!href.includes('#')) return null;
  try {
    const base = new URL(doc.baseURI);
    const parsed = new URL(href, base);
    if (!parsed.hash) return null;
    if (
      parsed.origin === base.origin
      && parsed.pathname === base.pathname
      && parsed.search === base.search
    ) {
      return parsed.hash.slice(1);
    }
  } catch {
    return null;
  }
  return null;
}

/** Slugify text for use as a heading id attribute. */
function textToSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normalize text for fuzzy slug comparison (strip non-alphanumeric). */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Assign id attributes to headings that don't have one.
 * Uses slugified heading text, matching the convention used by
 * most TOC generators. Duplicate slugs get a numeric suffix.
 */
function assignHeadingIds(doc: Document): void {
  const usedIds = new Set<string>();
  doc.querySelectorAll('[id]').forEach(el => usedIds.add(el.id));

  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    if (heading.id) return;
    const text = heading.textContent?.trim();
    if (!text) return;
    const slug = textToSlug(text);
    if (!slug) return;
    let candidate = slug;
    let counter = 1;
    while (usedIds.has(candidate)) {
      candidate = `${slug}-${counter++}`;
    }
    heading.id = candidate;
    usedIds.add(candidate);
  });
}

/** Resolve an anchor fragment to the target element in `doc`. */
function resolveAnchorTarget(doc: Document, fragment: string): Element | null {
  let decoded: string;
  try { decoded = decodeURIComponent(fragment); } catch { decoded = fragment; }
  // Fast path: exact id or name match
  const byId = doc.getElementById(fragment)
    || doc.getElementById(decoded)
    || doc.getElementsByName(fragment)[0]
    || doc.getElementsByName(decoded)[0];
  if (byId) return byId;

  // Fallback: match heading text content against the fragment
  const normFragment = normalizeForMatch(decoded);
  if (!normFragment) return null;
  const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of headings) {
    if (normalizeForMatch(h.textContent?.trim() || '') === normFragment) return h;
  }
  return null;
}

/** Find the nearest ancestor of `el` that is actually scrollable. */
function findScrollableAncestor(doc: Document, el: Element): Element | null {
  let node = el.parentElement;
  while (node && node !== doc.documentElement) {
    const style = getComputedStyle(node);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll')
      && node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Scroll the iframe viewport so `target` is at the top. */
function scrollIframeToTarget(doc: Document, target: Element): void {
  const scrollable = findScrollableAncestor(doc, target);
  if (scrollable) {
    const containerRect = scrollable.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scrollable.scrollTo({
      top: scrollable.scrollTop + (targetRect.top - containerRect.top),
      behavior: 'smooth',
    });
  } else {
    const win = doc.defaultView;
    if (win) {
      win.scrollTo({ top: target.getBoundingClientRect().top + win.scrollY, behavior: 'smooth' });
    }
  }
}

/**
 * Render the shared article viewer into the given container.
 * Bypasses the normal auth gate entirely.
 */
export async function renderSharedViewer(
  container: HTMLElement,
  shortCode: string,
): Promise<void> {
  let cleanupProgressTracking: (() => void) | null = null;
  let progressRafPending = false;

  const setSharedProgress = (percent: number) => {
    const fill = document.getElementById('sharedProgressFill') as HTMLElement | null;
    if (!fill) return;
    const clamped = Math.max(0, Math.min(100, percent));
    fill.style.width = `${clamped}%`;
  };

  const getSharedScrollPercent = (frame: HTMLIFrameElement): number => {
    const doc = frame.contentDocument;
    if (!doc) return 0;

    const html = doc.documentElement;
    const body = doc.body;
    if (!html) return 0;

    let scrollTop = 0;
    let scrollHeight = 0;
    let clientHeight = 0;

    // iOS Safari tracks viewport scroll on window, not documentElement/body.
    // Fall back to contentWindow.scrollY when scrollTop reads as 0.
    const win = frame.contentWindow;

    if (html.scrollHeight > html.clientHeight + 1) {
      scrollTop = html.scrollTop || win?.scrollY || 0;
      scrollHeight = html.scrollHeight;
      clientHeight = html.clientHeight;
    } else if (body && body.scrollHeight > body.clientHeight + 1) {
      scrollTop = body.scrollTop || win?.scrollY || 0;
      scrollHeight = body.scrollHeight;
      clientHeight = body.clientHeight;
    } else {
      return 100;
    }

    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    return (scrollTop / maxScroll) * 100;
  };

  const detachProgressTracking = () => {
    if (cleanupProgressTracking) {
      cleanupProgressTracking();
      cleanupProgressTracking = null;
    }
    progressRafPending = false;
  };

  const attachProgressTracking = (frame: HTMLIFrameElement) => {
    detachProgressTracking();
    const doc = frame.contentDocument;
    if (!doc) {
      setSharedProgress(0);
      return;
    }

    const html = doc.documentElement;
    const body = doc.body;
    const win = frame.contentWindow;

    const scheduleUpdate = () => {
      if (progressRafPending) return;
      progressRafPending = true;
      requestAnimationFrame(() => {
        progressRafPending = false;
        setSharedProgress(getSharedScrollPercent(frame));
      });
    };

    const options = { passive: true } as const;
    doc.addEventListener('scroll', scheduleUpdate, options);
    html?.addEventListener('scroll', scheduleUpdate, options);
    body?.addEventListener('scroll', scheduleUpdate, options);
    win?.addEventListener('scroll', scheduleUpdate, options);
    window.addEventListener('resize', scheduleUpdate, options);

    cleanupProgressTracking = () => {
      doc.removeEventListener('scroll', scheduleUpdate);
      html?.removeEventListener('scroll', scheduleUpdate);
      body?.removeEventListener('scroll', scheduleUpdate);
      win?.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };

    scheduleUpdate();
  };

  // Show loading state
  container.innerHTML = `
    <div class="shared-viewer">
      <div class="shared-viewer-chrome">
        <a class="shared-viewer-brand" href="https://transmogrifia.app">
          <img src="/icons/icon-64.png" alt="" width="24" height="24">
          <span>Transmogrifia</span>
        </a>
      </div>
      <div class="shared-viewer-progress hidden" id="sharedProgress" aria-hidden="true">
        <div class="shared-viewer-progress-fill" id="sharedProgressFill"></div>
      </div>
      <div class="shared-viewer-loading" id="sharedLoading">
        <div class="shared-viewer-spinner"></div>
        <p>Loading shared article…</p>
      </div>
      <iframe
        id="sharedFrame"
        class="shared-viewer-frame"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
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
    const frameEl = document.getElementById('sharedFrame') as HTMLIFrameElement | null;
    if (!frameEl) return;
    const frame = frameEl; // const binding narrows to non-null for closures

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
        html {
          max-width: 100vw !important;
          overflow-x: hidden !important;
          touch-action: pan-y pinch-zoom;
          overscroll-behavior: none;
          height: auto !important;
        }
        body {
          max-width: 100vw !important;
          overflow: visible !important;
          touch-action: pan-y pinch-zoom;
          overscroll-behavior: none;
          height: auto !important;
        }
        /* Clamp media elements to viewport width */
        img, video, iframe, embed, object, table, pre, code, svg {
          max-width: 100% !important;
          overflow-x: auto !important;
          box-sizing: border-box !important;
        }
        pre { white-space: pre-wrap !important; word-break: break-word !important; }
        /* Force JS-driven animation classes to visible state (scripts blocked by sandbox) */
        .io, .reveal, .cap, .cap-reveal { opacity: 1 !important; transform: none !important; }
        /* Contain fullbleed elements within their grid cell — prevents overlap
           when recipes nest full-viewport breakouts inside multi-column grids */
        .fullbleed {
          margin-left: 0 !important;
          margin-right: 0 !important;
          width: 100% !important;
        }
        /* Prevent author/byline blocks from floating outside reading column */
        [class*="author"], [class*="byline"], [class*="bio"],
        [class*="writer"], [class*="contributor"] {
          float: none !important;
          position: static !important;
          width: 100% !important;
          max-width: 100% !important;
          display: block !important;
        }
      </style>
    `;
    const htmlWithOverrides = html.includes('</head>')
      ? html.replace('</head>', `${styleOverride}</head>`)
      : styleOverride + html;

    frame.onload = () => {
      if (loading) loading.style.display = 'none';
      frame.style.display = 'block';
      const progress = document.getElementById('sharedProgress');
      if (progress) progress.classList.remove('hidden');
      attachProgressTracking(frame);

      // Retry until the contentDocument body has children (iOS Safari
      // can replace the document after load)
      let attempts = 0;
      function trySetup() {
        const doc = frame.contentDocument;
        if (!doc || !doc.body || !doc.body.childElementCount) {
          if (++attempts < 10) { requestAnimationFrame(trySetup); }
          return;
        }
        // Fix same-document hash links to scroll within iframe instead of navigating
        assignHeadingIds(doc);
        doc.querySelectorAll('a[href]').forEach(a => {
          a.addEventListener('click', (e) => {
            const href = a.getAttribute('href');
            if (!href) return;
            const fragment = getSameDocumentAnchorFragment(doc, href);
            if (fragment === null) return;
            e.preventDefault();
            const target = resolveAnchorTarget(doc, fragment);
            if (target) {
              scrollIframeToTarget(doc, target);
            } else {
              console.warn('[anchor] target not found for fragment:', fragment);
            }
          });
        });
        // External links open in new tab
        doc.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href');
          if (!href || getSameDocumentAnchorFragment(doc, href) !== null) return;
          (a as HTMLAnchorElement).target = '_blank';
          (a as HTMLAnchorElement).rel = 'noopener';
        });
        attachLightbox(frame);
      }
      requestAnimationFrame(trySetup);
    };
    frame.srcdoc = htmlWithOverrides;

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
    detachProgressTracking();
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
