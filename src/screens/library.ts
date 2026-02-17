import type { OneDriveArticleMeta, OneDriveImageAsset, SortOrder, FilterMode } from '../types';
import { signOut, getUserDisplayName } from '../services/auth';
import { downloadArticleHtml, uploadMeta, clearDeltaToken, downloadArticleAsset } from '../services/graph';
import {
  cacheHtml,
  getCachedHtml,
  getCacheStats,
  cacheMeta,
  clearCache,
  getCachedImage,
  cacheImage,
  getCachedImageColors,
  cacheImageColor,
  getSettingsValue,
} from '../services/cache';
import {
  requestSync,
  forceFullSync,
  refreshFromCache,
  mutateArticle,
  removeArticle,
  setArticles,
  updateCachedIds,
  subscribe as subscribeCoordinator,
  destroy as destroyCoordinator,
} from '../services/sync-coordinator';
import {
  getSortOrder,
  setSortOrder,
  getFilterMode,
  setFilterMode,
  getSidebarWidth,
  setSidebarWidth,
} from '../services/preferences';
import { renderArticleList } from '../components/article-list';
import { renderArticleHeader } from '../components/article-header';
import { showToast } from '../components/toast';
import { RECIPES, PICKER_RECIPES, getDefaultRecipeId, recipeRequiresAI } from '../recipes';
import { checkQueuePrereqs, queueForCloud } from '../services/cloud-queue';
import { escapeHtml } from '../utils/storage';
import { initBackSwipe, initOverscrollNav, destroyGestures } from '../gestures';
import { shareArticle, unshareArticle } from '../services/blob-storage';
import { getEffectiveSharingConfig, tryAutoImportFromCloud } from '../services/settings';
import { onBroadcast, postBroadcast } from '../services/broadcast';

/** A cloud job that is in progress (tracked client-side only). */
interface PendingJob {
  jobId: string;
  url: string;
  recipeId: string;
  title: string;      // hostname for display
  startTime: number;
  pollTimer?: ReturnType<typeof setTimeout>;
}

let articles: OneDriveArticleMeta[] = [];
let cachedIds = new Set<string>();
let currentId: string | null = null;
let searchQuery = '';
let sortOrder: SortOrder = 'newest';
let filterMode: FilterMode = 'all';
let container: HTMLElement;
let pendingJobs: PendingJob[] = [];
let selectedPendingId: string | null = null;
let activeBlobUrls: string[] = [];
let readerProgressCleanup: CleanupFn | null = null;
let readerProgressRafPending = false;

/** Epoch counter for openArticle race protection (Fix 8: U1) */
let openArticleEpoch = 0;

// ─── Global event listener lifecycle (Fix 9: U2) ──────────────────
type CleanupFn = () => void;
let screenCleanups: CleanupFn[] = [];

/** Register a global event listener that will be torn down on screen re-entry. */
function trackListener<K extends keyof DocumentEventMap>(
  target: EventTarget,
  event: K | string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions,
): void {
  target.addEventListener(event, handler, options);
  screenCleanups.push(() => target.removeEventListener(event, handler, options as boolean | EventListenerOptions | undefined));
}

/** Tear down all tracked global listeners from the current screen. */
export function teardownScreenListeners(): void {
  for (const cleanup of screenCleanups) cleanup();
  screenCleanups = [];
  detachReaderProgressTracking();
}

function setReaderProgress(percent: number): void {
  const fill = document.getElementById('readerProgressFill') as HTMLElement | null;
  if (!fill) return;
  const clamped = Math.max(0, Math.min(100, percent));
  fill.style.width = `${clamped}%`;
}

function resetReaderProgress(): void {
  setReaderProgress(0);
}

function getFrameScrollPercent(frame: HTMLIFrameElement): number {
  const doc = frame.contentDocument;
  if (!doc) return 0;

  const html = doc.documentElement;
  const body = doc.body;
  if (!html) return 0;

  let scrollTop = 0;
  let scrollHeight = 0;
  let clientHeight = 0;

  if (html.scrollHeight > html.clientHeight + 1) {
    scrollTop = html.scrollTop;
    scrollHeight = html.scrollHeight;
    clientHeight = html.clientHeight;
  } else if (body && body.scrollHeight > body.clientHeight + 1) {
    scrollTop = body.scrollTop;
    scrollHeight = body.scrollHeight;
    clientHeight = body.clientHeight;
  } else {
    // Non-scrollable documents are effectively complete.
    return 100;
  }

  const maxScroll = Math.max(1, scrollHeight - clientHeight);
  return (scrollTop / maxScroll) * 100;
}

function detachReaderProgressTracking(): void {
  if (readerProgressCleanup) {
    readerProgressCleanup();
    readerProgressCleanup = null;
  }
  readerProgressRafPending = false;
}

function attachReaderProgressTracking(frame: HTMLIFrameElement): void {
  detachReaderProgressTracking();

  const doc = frame.contentDocument;
  if (!doc) {
    resetReaderProgress();
    return;
  }

  const html = doc.documentElement;
  const body = doc.body;

  const scheduleUpdate = () => {
    if (readerProgressRafPending) return;
    readerProgressRafPending = true;
    requestAnimationFrame(() => {
      readerProgressRafPending = false;
      setReaderProgress(getFrameScrollPercent(frame));
    });
  };

  const options = { passive: true } as const;
  doc.addEventListener('scroll', scheduleUpdate, options);
  html?.addEventListener('scroll', scheduleUpdate, options);
  body?.addEventListener('scroll', scheduleUpdate, options);
  window.addEventListener('resize', scheduleUpdate, options);

  readerProgressCleanup = () => {
    doc.removeEventListener('scroll', scheduleUpdate);
    html?.removeEventListener('scroll', scheduleUpdate);
    body?.removeEventListener('scroll', scheduleUpdate);
    window.removeEventListener('resize', scheduleUpdate);
  };

  scheduleUpdate();
}

function releaseActiveBlobUrls(): void {
  for (const url of activeBlobUrls) {
    URL.revokeObjectURL(url);
  }
  activeBlobUrls = [];
}

/**
 * Resolve OneDrive image assets inside a live iframe document.
 * Two-phase approach for instant perceived load:
 *  1. Synchronous: set dimensions + dominant-color placeholder on all matched
 *     images so the layout is correct and visually filled immediately.
 *  2. Async: download blobs from cache/OneDrive, swap in real images, extract
 *     and cache dominant colors for next time.
 */
async function resolveImagesInFrame(
  doc: Document,
  meta: OneDriveArticleMeta,
): Promise<void> {
  if (!meta.images || meta.images.length === 0) return;

  const assetsById = new Map(meta.images.map((asset: OneDriveImageAsset) => [asset.id, asset] as const));
  const assetsBySrc = new Map(
    meta.images
      .filter((asset: OneDriveImageAsset) => asset.originalUrl)
      .map((asset: OneDriveImageAsset) => [asset.originalUrl as string, asset] as const),
  );

  const images = Array.from(doc.querySelectorAll('img')) as HTMLImageElement[];

  // Match images to assets and collect asset IDs for color lookup
  const matched: { img: HTMLImageElement; asset: OneDriveImageAsset }[] = [];
  for (const img of images) {
    const asset = findImageAsset(img, assetsById, assetsBySrc);
    if (asset) matched.push({ img, asset });
  }

  if (matched.length === 0) return;

  // Phase 1: apply placeholders — dimensions + dominant color from cache
  const assetIds = matched.map(m => m.asset.id);
  const colors = await getCachedImageColors(meta.id, assetIds);

  for (const { img, asset } of matched) {
    // Set dimensions to prevent layout shift
    if (asset.width && asset.height) {
      img.setAttribute('width', String(asset.width));
      img.setAttribute('height', String(asset.height));
      img.style.aspectRatio = `${asset.width} / ${asset.height}`;
    }
    // Apply placeholder with dominant color (or neutral fallback)
    const color = colors.get(asset.id);
    img.classList.add('tmg-img-placeholder');
    if (color) {
      img.style.setProperty('--tmg-placeholder-color', color);
    }
  }

  // Phase 2: load actual images
  const tasks = matched.map(async ({ img, asset }) => {
    try {
      let blob = await getCachedImage(meta.id, asset.id);
      const wasCacheMiss = !blob;
      if (!blob) {
        blob = await downloadArticleAsset(asset.drivePath);
        cacheImage(meta.id, asset.id, blob).catch(() => {});
      }
      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrls.push(blobUrl);

      // Swap in real image — remove placeholder once loaded
      img.onload = () => {
        img.classList.remove('tmg-img-placeholder');
        img.style.removeProperty('--tmg-placeholder-color');
      };
      img.setAttribute('src', blobUrl);
      img.setAttribute('data-tmg-asset-id', asset.id);

      // Extract and cache dominant color on first download
      if (wasCacheMiss && !colors.has(asset.id)) {
        extractDominantColor(blob).then(color => {
          if (color) cacheImageColor(meta.id, asset.id, color).catch(() => {});
        }).catch(() => {});
      }
    } catch (err) {
      img.classList.remove('tmg-img-placeholder');
      console.warn('Failed to resolve image asset:', asset.drivePath, err);
    }
  });

  await Promise.all(tasks);
}

/**
 * Extract the dominant color from an image blob by drawing it to a tiny
 * 1×1 canvas (the browser averages all pixels). Returns an rgb() string.
 */
async function extractDominantColor(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    bitmap.close();
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r},${g},${b})`;
  } catch {
    return null;
  }
}

function findImageAsset(
  img: HTMLImageElement,
  assetsById: Map<string, OneDriveImageAsset>,
  assetsBySrc: Map<string, OneDriveImageAsset>,
): OneDriveImageAsset | undefined {
  const assetId = img.getAttribute('data-tmg-asset-id');
  if (assetId && assetsById.has(assetId)) return assetsById.get(assetId);

  const src = img.getAttribute('src');

  // Match tmg-asset:{assetId} scheme — extract the ID and look up directly
  if (src?.startsWith('tmg-asset:')) {
    const id = src.slice('tmg-asset:'.length);
    if (assetsById.has(id)) return assetsById.get(id);
  }

  if (src && assetsBySrc.has(src)) return assetsBySrc.get(src);

  const originalSrc = img.getAttribute('data-tmg-asset-src');
  if (originalSrc && assetsBySrc.has(originalSrc)) return assetsBySrc.get(originalSrc);

  return undefined;
}

export function renderLibrary(root: HTMLElement): void {
  // Tear down global listeners from previous screen entry (Fix 9: U2)
  teardownScreenListeners();
  container = root;
  sortOrder = getSortOrder();
  filterMode = getFilterMode();

  container.innerHTML = `
    <div class="offline-banner">You're offline — showing cached articles</div>
    <div class="library-layout">
      <aside class="sidebar" style="width: ${getSidebarWidth()}px">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <img src="/icons/icon-32.png" alt="" class="brand-icon-sm" width="20" height="20">
            <span class="brand-text">Transmogrifia</span>
          </div>
          <div class="sidebar-header-actions">
            <button class="add-url-btn" id="addUrlBtn" title="Add a URL to transmogrify">+ Add</button>
            <div class="user-menu-wrapper">
              <button class="user-btn" id="userBtn" title="Account menu">
                <span class="user-initials" id="userInitials"></span>
              </button>
              <div class="user-dropdown hidden" id="userDropdown">
                <div class="user-dropdown-name" id="userDropdownName"></div>
                <hr class="user-dropdown-sep">
                <button class="user-dropdown-item" id="clearCacheBtn">🗑️ Clear cache</button>
                <button class="user-dropdown-item" id="settingsBtn">⚙️ Settings</button>
                <button class="user-dropdown-item" id="signOutBtn">🚪 Sign out</button>
              </div>
            </div>
          </div>
        </div>

        <div class="sidebar-controls">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" id="searchInput" placeholder="Search articles…">
            <button class="search-clear hidden" id="searchClear">✕</button>
          </div>
          <div class="filter-row">
            <select class="filter-select" id="filterSelect">
              <option value="all">All Articles</option>
              <option value="favorites">★ Favorites</option>
              <option value="downloaded">📥 Downloaded</option>
            </select>
            <select class="sort-select" id="sortSelect">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="alpha">A → Z</option>
            </select>
          </div>
        </div>

        <div class="divergence-notice hidden" id="divergenceNotice" role="alert">
          <span class="divergence-notice-text">Your library may be out of date</span>
          <button class="divergence-notice-btn" id="divergenceRefreshBtn">Refresh from Cloud</button>
        </div>

        <div class="article-list-container" id="articleList">
          <div class="skeleton-list">
            ${Array(6).fill('<div class="skeleton-item"><div class="skeleton-line long"></div><div class="skeleton-line short"></div></div>').join('')}
          </div>
        </div>

        <div class="sidebar-footer" id="sidebarFooter">
          <span class="sidebar-footer-stats" id="sidebarFooterStats"></span>
          <button class="sync-btn" id="syncBtn" title="Sync articles">
            <svg class="sync-icon" id="syncIcon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 8a6 6 0 1 1-1.5-4"/>
              <path d="M14 3v4h-4"/>
            </svg>
          </button>
        </div>
      </aside>

      <div class="resize-handle" id="resizeHandle"></div>

      <main class="reading-pane" id="readingPane">
        <div class="reader-titlebar" id="readerTitlebar"></div>
        <div class="reader-placeholder" id="readerPlaceholder">
          <span class="reader-placeholder-icon">📖</span>
          <p>Select an article to start reading</p>
        </div>
        <div class="reader-content hidden" id="readerContent">
          <div class="article-header-bar" id="articleHeaderBar"></div>
          <div class="reader-scroll-progress hidden" id="readerScrollProgress" aria-hidden="true">
            <div class="reader-scroll-progress-fill" id="readerProgressFill"></div>
          </div>
          <iframe
            id="contentFrame"
            class="content-frame"
            sandbox="allow-same-origin allow-popups"
            title="Article content"
          ></iframe>
        </div>
        <div class="reader-loading hidden" id="readerLoading">
          <div class="spinner"></div>
          <p>Downloading article…</p>
        </div>
        <div class="reader-error hidden" id="readerError">
          <p id="readerErrorMsg"></p>
          <button class="retry-btn" id="retryBtn">Retry</button>
        </div>
        <div class="reading-progress hidden" id="readingProgress">
          <div class="progress-card">
            <div class="progress-spinner-lg"></div>
            <h2 class="progress-page-title" id="progressTitle">Transmogrifying…</h2>
            <div class="progress-recipe" id="progressRecipe"></div>
            <div class="progress-step" id="progressStep">Generating…</div>
            <div class="progress-elapsed" id="progressElapsed"></div>
            <button class="progress-cancel-btn" id="progressCancel">Cancel</button>
          </div>
        </div>
        <div class="reader-fab" id="readerFab">
          <button class="fab-btn" id="fabBack" aria-label="Back to list" title="Back to list">←</button>
          <div class="fab-sep"></div>
          <button class="fab-btn" id="fabPrev" aria-label="Previous article" title="Previous article">↑</button>
          <button class="fab-btn" id="fabNext" aria-label="Next article" title="Next article">↓</button>
        </div>
      </main>
    </div>
  `;

  initLibrary().catch(err => {
    console.error('Library init failed:', err);
    showToast('Failed to load library', 'error');
  });
}

async function initLibrary(): Promise<void> {
  setupUserMenu();
  setupSyncButton();
  setupCoordinator();
  setupSearch();
  setupFilters();
  setupResizeHandle();
  setupKeyboardShortcuts();
  setupOfflineHandling();
  setupAddUrl();
  populateRecipeFilters();
  setSelectValues();
  setupFab();
  setupBroadcastListener();

  // On a new device with no settings, silently pull from OneDrive
  tryAutoImportFromCloud().then(imported => {
    if (imported) showToast('Settings imported from OneDrive');
  });

  // Load articles
  await requestSync();
}

function setSelectValues(): void {
  const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;
  const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;
  filterSelect.value = filterMode;
  sortSelect.value = sortOrder;
}

function populateRecipeFilters(): void {
  const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;
  for (const recipe of PICKER_RECIPES) {
    const opt = document.createElement('option');
    opt.value = recipe.id;
    opt.textContent = `${recipe.icon} ${recipe.name}`;
    filterSelect.appendChild(opt);
  }
}

/** Show a transient status message in the sidebar footer */
function updateSyncFooter(message: string | null): void {
  const statsEl = document.getElementById('sidebarFooterStats');
  if (!statsEl) return;
  if (message) {
    statsEl.dataset.syncMessage = message;
    statsEl.textContent = message;
  } else {
    delete statsEl.dataset.syncMessage;
    // Restore normal stats
    updateFooter();
  }
}

function getFilteredArticles(): OneDriveArticleMeta[] {
  let filtered = [...articles];

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      a =>
        a.title.toLowerCase().includes(q) ||
        a.recipeName?.toLowerCase().includes(q) ||
        a.originalUrl.toLowerCase().includes(q),
    );
  }

  // Filter
  switch (filterMode) {
    case 'favorites':
      filtered = filtered.filter(a => a.isFavorite);
      break;
    case 'downloaded':
      filtered = filtered.filter(a => cachedIds.has(a.id));
      break;
    case 'all':
      break;
    default:
      // Recipe filter
      filtered = filtered.filter(a => a.recipeId === filterMode);
      break;
  }

  // Sort
  switch (sortOrder) {
    case 'newest':
      filtered.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case 'oldest':
      filtered.sort((a, b) => a.createdAt - b.createdAt);
      break;
    case 'alpha':
      filtered.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }

  return filtered;
}

function renderList(): void {
  const listContainer = document.getElementById('articleList')!;
  const filtered = getFilteredArticles();
  const pending = pendingJobs.map(j => ({
    title: j.title,
    recipeId: j.recipeId,
    startTime: j.startTime,
    jobId: j.jobId,
  }));
  renderArticleList(listContainer, filtered, cachedIds, currentId, pending, selectedPendingId);

  // Attach click handlers for articles
  listContainer.querySelectorAll('.article-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.id!;
      openArticle(id);
    });
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const id = (el as HTMLElement).dataset.id!;
        openArticle(id);
      }
    });
  });

  // Attach click handlers for pending items
  listContainer.querySelectorAll('.article-item-pending').forEach(el => {
    el.addEventListener('click', () => {
      const jobId = (el as HTMLElement).dataset.jobId;
      if (jobId) selectPendingJob(jobId);
    });
  });
}

function selectPendingJob(jobId: string): void {
  const job = pendingJobs.find(j => j.jobId === jobId);
  if (!job) return;

  currentId = null;
  selectedPendingId = jobId;
  renderList();
  showPendingProgress(job);

  // Mobile: show reading pane
  if (window.innerWidth < 768) {
    document.body.classList.add('mobile-reading');
  }
}

function showPendingProgress(job: PendingJob): void {
  showReaderState('progress');

  const progressTitle = document.getElementById('progressTitle')!;
  const progressRecipe = document.getElementById('progressRecipe')!;
  const progressStep = document.getElementById('progressStep')!;
  const progressElapsed = document.getElementById('progressElapsed')!;
  const progressCancel = document.getElementById('progressCancel')!;

  progressTitle.textContent = job.title || 'Transmogrifying…';

  const recipe = RECIPES.find(r => r.id === job.recipeId);
  progressRecipe.textContent = recipe ? `${recipe.icon} ${recipe.name}` : job.recipeId;

  progressStep.textContent = '🤖 Generating…';

  const elapsed = Math.round((Date.now() - job.startTime) / 1000);
  progressElapsed.textContent = elapsed > 0 ? `${elapsed}s elapsed` : '';

  // Wire cancel button
  progressCancel.onclick = () => {
    if (!selectedPendingId) return;
    removePendingJob(selectedPendingId);
    selectedPendingId = null;
    showReaderState('placeholder');
    showToast('Generation cancelled');
  };
}

async function openArticle(id: string): Promise<void> {
  detachReaderProgressTracking();
  resetReaderProgress();

  currentId = id;
  selectedPendingId = null;
  // Increment epoch so any in-flight openArticle for a previous selection
  // discards its result instead of overwriting the iframe (Fix 8: U1)
  const epoch = ++openArticleEpoch;
  renderList(); // Update active state

  const meta = articles.find(a => a.id === id);
  if (!meta) return;

  // Check cache first — pass meta.size to detect regenerated articles
  let html = await getCachedHtml(id, meta.size);
  const wasCached = !!html;

  if (!html) {
    // Only show loading spinner when we actually need to download
    showReaderState('loading');
    document.body.classList.add('mobile-reading');

    try {
      html = await downloadArticleHtml(id);
      // Check epoch before rendering — user may have clicked another article
      if (epoch !== openArticleEpoch) return;
      await cacheHtml(id, html, meta.size);
      cachedIds.add(id);
      renderList(); // Update cloud badge
      updateFooter();
    } catch (err) {
      if (epoch !== openArticleEpoch) return;
      console.error('Failed to download article:', err);
      showReaderState('error', 'Failed to download article. Check your connection.');
      return;
    }
  }

  // Final epoch check before rendering
  if (epoch !== openArticleEpoch) return;

  // Render article header
  const headerBar = document.getElementById('articleHeaderBar')!;
  renderArticleHeader(headerBar, meta);

  // Attach header action handlers
  setupArticleActions(meta);

  releaseActiveBlobUrls();

  // Render in iframe — set srcdoc immediately so article text appears
  // without waiting for image resolution.
  const frame = document.getElementById('contentFrame') as HTMLIFrameElement;
  // Inject styles: hide extension UI + lock horizontal scroll + ensure vertical scroll
  //
  // IMPORTANT: overflow-x:hidden is only on <html>, NOT <body>.
  // Per CSS spec, setting one overflow axis to hidden/auto/scroll forces the
  // other axis from visible → auto. If body gets overflow-y:auto but has no
  // scrollable overflow (scrollH == clientH), it becomes a "scroll trap" —
  // the browser absorbs wheel events without actually scrolling, and never
  // propagates them up to <html> (the real scroll container).
  // Inject <base> so relative URLs (images, links) resolve against the
  // original article's site, not the PWA's origin.
  let baseTag = '';
  if (meta.originalUrl) {
    try {
      const base = new URL(meta.originalUrl);
      base.hash = '';
      base.search = '';
      baseTag = `<base href="${base.href}">`;
    } catch { /* invalid URL — skip */ }
  }

  const injectedStyles = `${baseTag}<style>
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
    /* Image placeholder: dominant-color background with shimmer animation */
    @keyframes tmg-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .tmg-img-placeholder {
      --tmg-placeholder-color: rgba(128,128,128,0.15);
      background: linear-gradient(
        90deg,
        var(--tmg-placeholder-color) 25%,
        color-mix(in srgb, var(--tmg-placeholder-color), white 30%) 50%,
        var(--tmg-placeholder-color) 75%
      ) !important;
      background-size: 200% 100% !important;
      animation: tmg-shimmer 1.5s ease-in-out infinite !important;
      object-fit: cover;
      min-height: 48px;
    }
  </style>`;

  // For cached articles, show content immediately — no spinner. The iframe
  // will render in-place while images resolve lazily in the background.
  // For downloaded articles the loading spinner is already visible; reveal
  // content once the iframe is ready.
  if (wasCached) {
    showReaderState('content');
    updateFabState(id);
    document.body.classList.add('mobile-reading');
  }

  // Set onload BEFORE srcdoc — srcdoc iframes can fire load for about:blank
  // before the real content; attaching handlers afterward risks missing it
  frame.onload = () => {
    // iOS Safari can replace the contentDocument after the load event;
    // retry with rAF until the document is fully settled.
    let attempts = 0;
    function trySetup() {
      const doc = frame.contentDocument;
      if (!doc || !doc.body || !doc.body.childElementCount) {
        if (++attempts < 10) {
          requestAnimationFrame(trySetup);
        } else if (id === currentId && !wasCached) {
          showReaderState('content');
          updateFabState(id);
        }
        return;
      }

      fixAnchorLinks(frame);
      fixScrollBlocking(frame);
      attachReaderProgressTracking(frame);

      // Resolve OneDrive image assets lazily (text is already visible).
      // meta is guaranteed non-null — openArticle returns early if not found.
      resolveImagesInFrame(doc, meta!).catch(err =>
        console.warn('Failed to resolve article images:', err),
      );

      // Gestures — attach to the settled contentDocument
      destroyGestures();

      // Back swipe — always initialised; the handler itself checks viewport
      // width at swipe time so resizing from wide → narrow works immediately.
      const readingPane = document.querySelector('.reading-pane') as HTMLElement;
      if (readingPane) {
        initBackSwipe(readingPane, frame, () => goBack());
      }

      // Overscroll prev/next works on all viewports
      initOverscrollNav(frame, (dir) => {
        const filtered = getFilteredArticles();
        const idx = filtered.findIndex(a => a.id === id);
        const target = dir === 'prev' ? filtered[idx - 1] : filtered[idx + 1];
        if (target) openArticle(target.id);
      });

      // For downloads, reveal content now that the iframe is ready.
      // For cached articles, content is already visible.
      if (id === currentId && !wasCached) {
        showReaderState('content');
        updateFabState(id);
      }
    }
    requestAnimationFrame(trySetup);
  };

  frame.srcdoc = html.replace('</head>', injectedStyles + '</head>');
}

function goBack(): void {
  detachReaderProgressTracking();
  resetReaderProgress();
  destroyGestures();
  releaseActiveBlobUrls();
  document.body.classList.remove('mobile-reading');
  currentId = null;
  selectedPendingId = null;
  renderList();
  showReaderState('placeholder');
  // Prevent lingering focus on article items after mobile back transition
  (document.activeElement as HTMLElement | null)?.blur();
}

function updateFabState(id: string): void {
  const filtered = getFilteredArticles();
  const idx = filtered.findIndex(a => a.id === id);
  const prevBtn = document.getElementById('fabPrev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('fabNext') as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = idx <= 0;
  if (nextBtn) nextBtn.disabled = idx < 0 || idx >= filtered.length - 1;
}

function setupFab(): void {
  const fabBack = document.getElementById('fabBack');
  const fabPrev = document.getElementById('fabPrev');
  const fabNext = document.getElementById('fabNext');

  fabBack?.addEventListener('click', () => goBack());

  fabPrev?.addEventListener('click', () => {
    if (!currentId) return;
    const filtered = getFilteredArticles();
    const idx = filtered.findIndex(a => a.id === currentId);
    if (idx > 0) openArticle(filtered[idx - 1].id);
  });

  fabNext?.addEventListener('click', () => {
    if (!currentId) return;
    const filtered = getFilteredArticles();
    const idx = filtered.findIndex(a => a.id === currentId);
    if (idx >= 0 && idx < filtered.length - 1) openArticle(filtered[idx + 1].id);
  });
}

function setupArticleActions(meta: OneDriveArticleMeta): void {
  // Back button (mobile)
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => goBack());
  }

  // Favorite toggle
  const favBtn = document.getElementById('favBtn');
  if (favBtn) {
    favBtn.addEventListener('click', () => toggleFavorite(meta.id));
  }

  // Open original
  const origBtn = document.getElementById('origBtn');
  if (origBtn) {
    origBtn.addEventListener('click', () => {
      window.open(meta.originalUrl, '_blank', 'noopener');
    });
  }

  // Delete article
  const delBtn = document.getElementById('delBtn');
  if (delBtn) {
    delBtn.addEventListener('click', () => confirmDeleteArticle(meta));
  }

  // Share article
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => handleShareClick(meta));
  }
}

function toggleFavorite(id: string): void {
  const meta = articles.find(a => a.id === id);
  if (!meta) return;

  // Update UI immediately
  const favBtn = document.getElementById('favBtn');
  if (favBtn) {
    favBtn.classList.toggle('active', !meta.isFavorite);
  }

  // Delegate to coordinator — optimistic update, cache, upload, retry, rollback
  mutateArticle(id, m => { m.isFavorite = !m.isFavorite; }, {
    mergeFn: (local, remote) => {
      remote.isFavorite = local.isFavorite;
      return remote;
    },
  });
}

async function confirmDeleteArticle(meta: OneDriveArticleMeta): Promise<void> {
  const title = meta.title.length > 50 ? meta.title.slice(0, 50) + '…' : meta.title;
  if (!confirm(`Delete "${title}"?\n\nThis will remove the article from OneDrive and cannot be undone.`)) {
    return;
  }

  try {
    goBack();
    await removeArticle(meta.id);
    showToast('Article deleted');
  } catch (err) {
    console.error('Failed to delete article:', err);
    showToast('Failed to delete article', 'error');
  }
}

function handleShareClick(meta: OneDriveArticleMeta): void {
  // Remove existing share modal if any
  document.getElementById('shareModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'shareModal';
  overlay.className = 'modal-overlay';

  if (meta.sharedUrl) {
    // Already shared — show link with copy + unshare options
    const expiresInfo = meta.shareExpiresAt
      ? `<p class="share-expires">Expires ${new Date(meta.shareExpiresAt).toLocaleDateString()}</p>`
      : '';

    overlay.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h2>🔗 Shared Article</h2>
          <button class="modal-close" id="shareModalClose" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p>This article is shared:</p>
          <div class="share-url-row">
            <input type="text" class="share-url-input" id="shareUrlDisplay" value="${escapeHtml(meta.sharedUrl)}" readonly>
            <button class="settings-btn settings-btn-secondary share-copy-inline" id="shareCopyInline" title="Copy to clipboard">📋</button>
          </div>
          ${expiresInfo}
        </div>
        <div class="modal-footer">
          <button class="settings-btn settings-btn-danger" id="shareUnshareBtn">Unshare</button>
          <button class="settings-btn settings-btn-primary" id="shareCopyCloseBtn">📋 Copy URL</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('shareModalClose')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Inline copy button
    document.getElementById('shareCopyInline')!.addEventListener('click', () => {
      navigator.clipboard.writeText(meta.sharedUrl!).then(() => {
        const btn = document.getElementById('shareCopyInline')!;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📋'; }, 2000);
      });
    });

    // Copy & close button
    document.getElementById('shareCopyCloseBtn')!.addEventListener('click', async () => {
      await navigator.clipboard.writeText(meta.sharedUrl!);
      showToast('Share link copied!');
      close();
    });

    // Unshare button
    document.getElementById('shareUnshareBtn')!.addEventListener('click', async () => {
      const btn = document.getElementById('shareUnshareBtn') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Removing…';
      try {
        await unshareArticle(meta.id, meta.shareShortCode || '');
        meta.sharedUrl = undefined;
        meta.sharedBlobUrl = undefined;
        meta.shareShortCode = undefined;
        meta.sharedAt = undefined;
        meta.shareExpiresAt = undefined;
        meta.updatedAt = Date.now();
        await cacheMeta(meta);
        await uploadMeta(meta);
        updateShareButton(meta);
        showToast('Share link removed');
        close();
      } catch (err) {
        console.error('Failed to unshare:', err);
        const is412 = err instanceof Error && err.message.includes('412');
        showToast(
          is412 ? 'This article changed on another device. Sync and retry.' : 'Failed to remove share link',
          'error',
        );
        btn.disabled = false;
        btn.textContent = 'Unshare';
      }
    });
  } else {
    // Not shared — show share form with expiration picker
    overlay.innerHTML = `
      <div class="modal-dialog modal-sm">
        <div class="modal-header">
          <h2>📤 Share Article</h2>
          <button class="modal-close" id="shareModalClose" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p class="share-description">Share this article with a public link. Anyone with the link can view it.</p>
          <div class="settings-field">
            <label for="shareExpiration">Expires</label>
            <select id="shareExpiration">
              <option value="0">Never</option>
              <option value="7">7 days</option>
              <option value="30" selected>30 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="settings-btn settings-btn-secondary" id="shareCancelBtn">Cancel</button>
          <button class="settings-btn settings-btn-primary" id="shareConfirmBtn">📤 Share</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('shareModalClose')!.addEventListener('click', close);
    document.getElementById('shareCancelBtn')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('shareConfirmBtn')!.addEventListener('click', async () => {
      const confirmBtn = document.getElementById('shareConfirmBtn') as HTMLButtonElement;
      const cancelBtn = document.getElementById('shareCancelBtn') as HTMLButtonElement;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Sharing…';
      cancelBtn.style.display = 'none';

      // Check sharing is configured
      const config = await getEffectiveSharingConfig();
      if (!config) {
        showToast('Set up sharing in Settings first', 'error');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '📤 Share';
        cancelBtn.style.display = '';
        return;
      }

      // Get article HTML
      let html = await getCachedHtml(meta.id, meta.size);
      if (!html) {
        try {
          html = await downloadArticleHtml(meta.id);
        } catch {
          showToast('Failed to load article for sharing', 'error');
          confirmBtn.disabled = false;
          confirmBtn.textContent = '📤 Share';
          cancelBtn.style.display = '';
          return;
        }
      }

      const expirationDays = parseInt((document.getElementById('shareExpiration') as HTMLSelectElement).value);
      const expiresAt = expirationDays > 0 ? Date.now() + expirationDays * 24 * 60 * 60 * 1000 : undefined;

      try {
        const result = await shareArticle(meta.id, html, meta.title, meta.originalUrl, expiresAt, meta.images);

        // Update meta
        meta.sharedUrl = result.shareUrl;
        meta.sharedBlobUrl = result.blobUrl;
        meta.shareShortCode = result.shortCode;
        meta.sharedAt = Date.now();
        meta.shareExpiresAt = expiresAt;
        meta.updatedAt = Date.now();
        await cacheMeta(meta);
        await uploadMeta(meta);
        updateShareButton(meta);

        // Transform dialog to show the URL with copy button
        const body = document.getElementById('shareModal')!.querySelector('.modal-body')!;
        body.innerHTML = `
          <p>Article shared successfully!</p>
          <div class="share-url-row">
            <input type="text" class="share-url-input" id="shareUrlDisplay" value="${escapeHtml(result.shareUrl)}" readonly>
            <button class="settings-btn settings-btn-secondary share-copy-inline" id="shareCopyInline" title="Copy to clipboard">📋</button>
          </div>
        `;

        // Update header
        const header = document.getElementById('shareModal')!.querySelector('.modal-header h2')!;
        header.textContent = '🔗 Shared!';

        // Replace footer with copy-to-close button
        const footer = document.getElementById('shareModal')!.querySelector('.modal-footer')!;
        footer.innerHTML = `
          <button class="settings-btn settings-btn-primary" id="shareCopyCloseBtn">📋 Copy URL</button>
        `;

        // Inline copy
        document.getElementById('shareCopyInline')!.addEventListener('click', () => {
          navigator.clipboard.writeText(result.shareUrl).then(() => {
            const btn = document.getElementById('shareCopyInline')!;
            btn.textContent = '✓';
            setTimeout(() => { btn.textContent = '📋'; }, 2000);
          });
        });

        // Copy & close
        document.getElementById('shareCopyCloseBtn')!.addEventListener('click', async () => {
          await navigator.clipboard.writeText(result.shareUrl);
          showToast('Share link copied!');
          overlay.remove();
        });
      } catch (err) {
        console.error('Failed to share article:', err);
        const is412 = err instanceof Error && err.message.includes('412');
        showToast(
          is412 ? 'This article changed on another device. Sync and retry.' : (err instanceof Error ? err.message : 'Failed to share article'),
          'error',
        );
        confirmBtn.disabled = false;
        confirmBtn.textContent = '📤 Share';
        cancelBtn.style.display = '';
        updateShareButton(meta);
      }
    });
  }
}

function updateShareButton(meta: OneDriveArticleMeta): void {
  const shareBtn = document.getElementById('shareBtn');
  if (!shareBtn) return;
  shareBtn.classList.remove('sharing');
  const icon = shareBtn.querySelector('.share-icon') as HTMLElement;
  if (icon) icon.textContent = meta.sharedUrl ? '🔗' : '📤';
  shareBtn.classList.toggle('active', !!meta.sharedUrl);
  shareBtn.title = meta.sharedUrl ? 'Manage share link' : 'Share article';
}

function showReaderState(state: 'placeholder' | 'loading' | 'content' | 'error' | 'progress', errorMsg?: string): void {
  const placeholder = document.getElementById('readerPlaceholder')!;
  const loading = document.getElementById('readerLoading')!;
  const content = document.getElementById('readerContent')!;
  const error = document.getElementById('readerError')!;
  const progress = document.getElementById('readingProgress')!;
  const readerProgress = document.getElementById('readerScrollProgress');

  placeholder.classList.toggle('hidden', state !== 'placeholder');
  loading.classList.toggle('hidden', state !== 'loading');
  content.classList.toggle('hidden', state !== 'content');
  error.classList.toggle('hidden', state !== 'error');
  progress.classList.toggle('hidden', state !== 'progress');
  if (readerProgress) readerProgress.classList.toggle('hidden', state !== 'content');

  if (state !== 'content') {
    detachReaderProgressTracking();
    resetReaderProgress();
  }

  // Hide the WCO titlebar strip when the article header is visible
  const titlebar = document.getElementById('readerTitlebar');
  if (titlebar) titlebar.classList.toggle('hidden', state === 'content');

  if (state === 'error' && errorMsg) {
    document.getElementById('readerErrorMsg')!.textContent = errorMsg;
    const retryBtn = document.getElementById('retryBtn')!;
    retryBtn.onclick = () => {
      if (currentId) openArticle(currentId);
    };
  }
}

function setupUserMenu(): void {
  const displayName = getUserDisplayName();
  const initials = displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  document.getElementById('userInitials')!.textContent = initials;
  document.getElementById('userDropdownName')!.textContent = displayName;

  const userBtn = document.getElementById('userBtn')!;
  const dropdown = document.getElementById('userDropdown')!;

  userBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  trackListener(document, 'click', () => {
    dropdown.classList.add('hidden');
  });

  document.getElementById('signOutBtn')!.addEventListener('click', async () => {
    await clearCache();
    await clearDeltaToken();
    await signOut();
    postBroadcast({ type: 'auth-changed', signedIn: false });
    window.location.reload();
  });

  document.getElementById('settingsBtn')!.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    location.hash = '#settings';
  });

  document.getElementById('clearCacheBtn')!.addEventListener('click', async () => {
    await clearCache();
    await clearDeltaToken();
    setArticles([]);
    updateCachedIds(new Set());
    cachedIds = new Set();
    showToast('Cache cleared — syncing…');
    dropdown.classList.add('hidden');
    await requestSync();
  });
}

function setupSearch(): void {
  const input = document.getElementById('searchInput') as HTMLInputElement;
  const clearBtn = document.getElementById('searchClear')!;

  input.addEventListener('input', () => {
    searchQuery = input.value.trim();
    clearBtn.classList.toggle('hidden', !searchQuery);
    renderList();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    clearBtn.classList.add('hidden');
    renderList();
    input.focus();
  });
}

function setupFilters(): void {
  const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;
  const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;

  filterSelect.addEventListener('change', () => {
    filterMode = filterSelect.value as FilterMode;
    setFilterMode(filterMode);
    renderList();
  });

  sortSelect.addEventListener('change', () => {
    sortOrder = sortSelect.value as SortOrder;
    setSortOrder(sortOrder);
    renderList();
  });
}

function setupResizeHandle(): void {
  const handle = document.getElementById('resizeHandle')!;
  const sidebar = container.querySelector('.sidebar') as HTMLElement;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;

    const onMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(260, Math.min(600, startWidth + e.clientX - startX));
      sidebar.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setSidebarWidth(sidebar.offsetWidth);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function setupKeyboardShortcuts(): void {
  const handler = (e: Event) => {
    const ke = e as KeyboardEvent;
    // Don't handle if typing in input
    if (ke.target instanceof HTMLInputElement || ke.target instanceof HTMLTextAreaElement) {
      if (ke.key === 'Escape') {
        (ke.target as HTMLElement).blur();
        const clearBtn = document.getElementById('searchClear');
        if (clearBtn) clearBtn.click();
      }
      return;
    }

    const filtered = getFilteredArticles();
    const currentIndex = currentId ? filtered.findIndex(a => a.id === currentId) : -1;

    switch (ke.key) {
      case 'j': // Next article
        if (currentIndex < filtered.length - 1) {
          openArticle(filtered[currentIndex + 1].id);
        }
        break;
      case 'k': // Previous article
        if (currentIndex > 0) {
          openArticle(filtered[currentIndex - 1].id);
        }
        break;
      case 'f': // Toggle favorite
        if (currentId) toggleFavorite(currentId);
        break;
      case '/': // Focus search
        ke.preventDefault();
        document.getElementById('searchInput')?.focus();
        break;
      case 'Escape': // Close reader on mobile
        if (document.body.classList.contains('mobile-reading')) {
          goBack();
        }
        break;
    }
  };
  trackListener(document, 'keydown', handler);
}

function setupOfflineHandling(): void {
  const updateStatus = () => {
    document.body.classList.toggle('is-offline', !navigator.onLine);
  };
  trackListener(window, 'online', updateStatus);
  trackListener(window, 'offline', updateStatus);
  updateStatus();
}

/**
 * Listen for cross-tab broadcast events (Fix 10).
 * When another tab syncs or mutates an article, refresh from cache.
 */
function setupBroadcastListener(): void {
  const unsubscribe = onBroadcast(async (event) => {
    switch (event.type) {
      case 'sync-complete':
      case 'article-mutated':
        // Refresh from cache without triggering a Graph sync
        await refreshFromCache();
        break;
      // auth-changed and settings-updated are handled by main.ts / settings.ts
    }
  });
  screenCleanups.push(unsubscribe);
}

function setupSyncButton(): void {
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      await requestSync();
      showToast('Sync complete');
    });
  }
}

/**
 * Subscribe to SyncCoordinator events and map them to UI updates (Fix 20).
 * Also wires the divergence "Refresh from Cloud" button (Fix 16).
 */
function setupCoordinator(): void {
  // Divergence refresh button (Fix 16)
  const refreshBtn = document.getElementById('divergenceRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const notice = document.getElementById('divergenceNotice');
      if (notice) notice.classList.add('hidden');
      await forceFullSync();
      showToast('Refreshed from cloud');
    });
  }

  const unsubscribe = subscribeCoordinator((event) => {
    switch (event.type) {
      case 'sync-start':
        setSyncIndicator(true);
        break;

      case 'sync-end':
        setSyncIndicator(false);
        updateFooter();
        break;

      case 'articles-updated':
        articles = event.articles;
        cachedIds = event.cachedIds;
        renderList();
        updateFooter();
        break;

      case 'sync-message':
        updateSyncFooter(event.message);
        break;

      case 'divergence': {
        const notice = document.getElementById('divergenceNotice');
        if (notice) notice.classList.toggle('hidden', !event.show);
        break;
      }

      case 'sync-error':
        if (!event.hasCache) {
          showToast('Could not load articles. Check your connection and try again.', 'error');
        }
        break;

      case 'mutation-reverted':
        showToast('Failed to save change — reverted', 'error');
        // Re-sync the favorite button state if the reader is open
        if (currentId === event.articleId) {
          const meta = articles.find(a => a.id === event.articleId);
          const favBtn = document.getElementById('favBtn');
          if (meta && favBtn) {
            favBtn.classList.toggle('active', meta.isFavorite);
          }
        }
        break;
    }
  });
  screenCleanups.push(unsubscribe);
  screenCleanups.push(() => destroyCoordinator());
}

function setupAddUrl(): void {
  const addBtn = document.getElementById('addUrlBtn');
  if (!addBtn) return;

  addBtn.addEventListener('click', async () => {
    const error = await checkQueuePrereqs(getDefaultRecipeId());
    if (error) {
      showToast(error, 'error');
      return;
    }
    showAddUrlModal();
  });
}

export function showAddUrlModal(prefillUrl?: string): void {
  // Remove existing modal if any
  document.getElementById('addUrlModal')?.remove();

  const defaultRecipeId = getDefaultRecipeId();
  const recipeOptions = PICKER_RECIPES.map(r => {
    const selected = r.id === defaultRecipeId ? ' selected' : '';
    return `<option value="${escapeHtml(r.id)}"${selected}>${escapeHtml(r.icon + ' ' + r.name)}</option>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'addUrlModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-header">
        <h2>Add URL</h2>
        <button class="modal-close" id="addUrlClose" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="settings-field">
          <label for="addUrlInput">URL</label>
          <input type="url" id="addUrlInput" placeholder="https://example.com/article" autofocus>
        </div>
        <div class="settings-field">
          <label for="addUrlRecipe">Recipe</label>
          <select id="addUrlRecipe">${recipeOptions}</select>
        </div>
        <div class="settings-field">
          <label for="addUrlPrompt">Custom prompt (optional)</label>
          <input type="text" id="addUrlPrompt" placeholder="Additional instructions…">
        </div>
        <div class="settings-field settings-field-toggle">
          <label for="addUrlImages">
            <input type="checkbox" id="addUrlImages">
            <span>Generate images</span>
          </label>
          <span class="settings-field-hint">Requires an image provider configured in Settings</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="settings-btn settings-btn-secondary" id="addUrlCancel">Cancel</button>
        <button class="settings-btn settings-btn-primary" id="addUrlSubmit">✨ Transmogrify</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Pre-fill and focus the URL input
  const urlInput = document.getElementById('addUrlInput') as HTMLInputElement;
  if (prefillUrl) {
    urlInput.value = prefillUrl;
  }
  requestAnimationFrame(() => urlInput?.focus());

  // Show/hide custom prompt based on recipe
  const recipeSelect = document.getElementById('addUrlRecipe') as HTMLSelectElement;
  const promptField = document.getElementById('addUrlPrompt')!.closest('.settings-field') as HTMLElement;
  promptField.classList.toggle('hidden', recipeSelect.value !== 'custom');
  recipeSelect.addEventListener('change', () => {
    promptField.classList.toggle('hidden', recipeSelect.value !== 'custom');
  });

  // Close handlers
  const close = () => overlay.remove();
  document.getElementById('addUrlClose')!.addEventListener('click', close);
  document.getElementById('addUrlCancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Submit handler
  document.getElementById('addUrlSubmit')!.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showToast('Please enter a URL', 'error');
      return;
    }

    try {
      new URL(url); // Validate URL
    } catch {
      showToast('Please enter a valid URL', 'error');
      return;
    }

    const recipe = recipeSelect.value;
    const prereqError = await checkQueuePrereqs(recipe);
    if (prereqError) {
      showToast(prereqError, 'error');
      return;
    }

    const customPrompt = (document.getElementById('addUrlPrompt') as HTMLInputElement).value.trim() || undefined;
    const generateImages = recipeRequiresAI(recipe)
      ? (document.getElementById('addUrlImages') as HTMLInputElement).checked
      : false;

    const submitBtn = document.getElementById('addUrlSubmit') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Queuing…';

    try {
      const result = await queueForCloud(url, recipe, customPrompt, generateImages);
      close();

      // Track as a pending job in the sidebar
      let hostname: string;
      try { hostname = new URL(url).hostname; } catch { hostname = url; }
      addPendingJob(result.jobId, url, recipe, hostname);

      showToast('Queued — article will appear shortly');
    } catch (err) {
      showToast('Queue failed: ' + (err as Error).message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = '✨ Transmogrify';
    }
  });
}

function setSyncIndicator(syncing: boolean): void {
  const icon = document.getElementById('syncIcon');
  if (icon) {
    icon.classList.toggle('spinning', syncing);
  }
  const btn = document.getElementById('syncBtn') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = syncing;
  }
}

async function updateFooter(): Promise<void> {
  const statsEl = document.getElementById('sidebarFooterStats')!;
  // Don't overwrite a transient sync message (Fix 6)
  if (statsEl.dataset.syncMessage) return;
  const stats = await getCacheStats();
  const sizeMB = (stats.totalSize / (1024 * 1024)).toFixed(1);
  // Show last synced time (Fix 13)
  const lastSync = await getSettingsValue<number>('lastSyncTime');
  const syncLabel = lastSync ? ` · synced ${formatRelativeTime(lastSync)}` : '';
  statsEl.textContent = `${articles.length} articles · ${stats.count} cached · ${sizeMB} MB${syncLabel}`;
}

/** Format a timestamp as a human-readable relative time string */
function formatRelativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function fixAnchorLinks(frame: HTMLIFrameElement): void {
  try {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href === '#') return;
        const target = doc.getElementById(href.slice(1));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
    // External links open in new tab
    doc.querySelectorAll('a[href^="http"]').forEach(link => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    });
  } catch {
    // Cross-origin — ignore
  }
}

/**
 * Fix elements inside the article iframe that block mousewheel scrolling.
 *
 * Many modern sites wrap content in `overflow: hidden` containers
 * (e.g. `#root`, `.page-wrapper`). This walks the DOM tree from `<body>`
 * down through single-child wrapper chains (the typical "app shell" pattern)
 * and clears overflow constraints.
 *
 * When changing overflow, we must avoid creating "scroll traps" — elements
 * with `overflow: auto` but no actual overflow (scrollH == clientH) absorb
 * wheel events without scrolling and prevent propagation to the real scroll
 * container. So we use `visible` (which lets events pass through) unless
 * the element genuinely has scrollable overflow.
 */
function fixScrollBlocking(frame: HTMLIFrameElement): void {
  try {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return;

    // Walk from body through single-child-element wrappers
    let node: HTMLElement | null = doc.body;
    let depth = 0;
    while (node && depth < 6) {
      const style = getComputedStyle(node);

      if (style.overflowY === 'hidden' || style.overflowY === 'clip') {
        // If the element has real scrollable overflow, make it a scroll
        // container. Otherwise use 'visible' to let events pass through.
        const hasOverflow = node.scrollHeight > node.clientHeight + 1;
        node.style.setProperty('overflow-y', hasOverflow ? 'auto' : 'visible', 'important');
        // overflow-x must also be set to visible to avoid the CSS spec rule
        // that forces the other axis from visible → auto.
        if (!hasOverflow) {
          node.style.setProperty('overflow-x', 'visible', 'important');
        }
      }

      // Only descend into single-element children (the wrapper pattern);
      // if there are multiple children this is real content, stop.
      const visibleChildren: HTMLElement[] = [];
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child instanceof HTMLElement && getComputedStyle(child).display !== 'none') {
          visibleChildren.push(child);
        }
      }
      if (visibleChildren.length === 1) {
        node = visibleChildren[0];
        depth++;
      } else {
        break;
      }
    }
  } catch {
    // Cross-origin — ignore
  }
}

// ─── Pending Job Tracking ──────────────────────────────

/** Interval that re-renders pending items to update elapsed time */
let pendingTickTimer: ReturnType<typeof setInterval> | null = null;

function addPendingJob(jobId: string, url: string, recipeId: string, title: string): void {
  const job: PendingJob = {
    jobId,
    url,
    recipeId,
    title,
    startTime: Date.now(),
  };

  pendingJobs.push(job);
  renderList();

  // Start polling for the new article — cloud jobs typically take 20-60s
  startPendingPoll(job);

  // Start the elapsed-time tick if not already running
  if (!pendingTickTimer) {
    pendingTickTimer = setInterval(() => {
      if (pendingJobs.length === 0) {
        clearInterval(pendingTickTimer!);
        pendingTickTimer = null;
        return;
      }
      renderList();
      // Update progress pane elapsed time if a pending item is selected
      if (selectedPendingId) {
        const job = pendingJobs.find(j => j.jobId === selectedPendingId);
        if (job) {
          const elapsed = Math.round((Date.now() - job.startTime) / 1000);
          const el = document.getElementById('progressElapsed');
          if (el) el.textContent = elapsed > 0 ? `${elapsed}s elapsed` : '';
        }
      }
    }, 5_000);
  }
}

/**
 * Poll for completion of a pending cloud job by syncing articles.
 * Checks at 15s, 30s, 60s, then every 30s up to 10 minutes.
 */
function startPendingPoll(job: PendingJob): void {
  const intervals = [15_000, 30_000, 60_000]; // first three delays
  const STEADY_INTERVAL = 30_000;
  const MAX_AGE = 10 * 60 * 1000;
  let attempt = 0;

  function scheduleNext() {
    const elapsed = Date.now() - job.startTime;
    if (elapsed > MAX_AGE) {
      // Give up — remove from pending
      removePendingJob(job.jobId);
      showToast('Cloud job timed out. Try syncing manually.', 'error');
      return;
    }

    const delay = attempt < intervals.length ? intervals[attempt] : STEADY_INTERVAL;
    attempt++;

    job.pollTimer = setTimeout(async () => {
      // Check if this job was already resolved
      if (!pendingJobs.find(j => j.jobId === job.jobId)) return;

      try {
        const prevCount = articles.length;
        await requestSync();

        // If new articles appeared, check if any match this job's URL
        if (articles.length > prevCount) {
          const newArticle = articles.find(a =>
            a.originalUrl === job.url && a.createdAt > job.startTime - 5000
          );
          if (newArticle) {
            removePendingJob(job.jobId);
            showToast(`"${newArticle.title}" is ready!`);
            openArticle(newArticle.id);
            return;
          }
        }
      } catch {
        // Sync failed — try again next interval
      }

      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

function removePendingJob(jobId: string): void {
  const job = pendingJobs.find(j => j.jobId === jobId);
  if (job?.pollTimer) clearTimeout(job.pollTimer);
  pendingJobs = pendingJobs.filter(j => j.jobId !== jobId);
  if (selectedPendingId === jobId) {
    selectedPendingId = null;
  }
  renderList();
}
