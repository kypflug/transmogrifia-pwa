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
        <div class="shared-viewer-brand">
          <img src="/icons/icon-64.png" alt="" width="24" height="24">
          <span>Library of Transmogrifia</span>
        </div>
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
    // 1. Resolve the short code to a blob URL
    const { url, title } = await resolveShareCode(shortCode);

    // Update page title
    document.title = `${title} — Library of Transmogrifia`;

    // 2. Fetch the article HTML from blob storage (public, no auth)
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load article (${response.status})`);
    }
    const html = await response.text();

    // 3. Render in sandboxed iframe
    const loading = document.getElementById('sharedLoading');
    const frame = document.getElementById('sharedFrame') as HTMLIFrameElement | null;
    if (!frame) return;

    // Inject style overrides to hide the save FAB and fix viewport
    const styleOverride = `
      <style>
        .remix-save-fab { display: none !important; }
        html, body { overflow-x: hidden; max-width: 100vw; }
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

    // Update the chrome bar with title and original link info
    const chrome = container.querySelector('.shared-viewer-chrome');
    if (chrome) {
      chrome.innerHTML = `
        <div class="shared-viewer-brand">
          <img src="/icons/icon-64.png" alt="" width="24" height="24">
          <span>Library of Transmogrifia</span>
        </div>
        <div class="shared-viewer-title">${escapeHtml(title)}</div>
        <a class="shared-viewer-cta" href="/" title="Get the app">
          Open App
        </a>
      `;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Something went wrong.';
    container.innerHTML = `
      <div class="shared-viewer">
        <div class="shared-viewer-chrome">
          <div class="shared-viewer-brand">
            <img src="/icons/icon-64.png" alt="" width="24" height="24">
            <span>Library of Transmogrifia</span>
          </div>
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
