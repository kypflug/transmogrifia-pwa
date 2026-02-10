import type { OneDriveArticleMeta, SortOrder, FilterMode } from '../types';
import { signOut, getUserDisplayName } from '../services/auth';
import { downloadArticleHtml, uploadMeta, deleteArticle, syncArticles, clearDeltaToken } from '../services/graph';
import {
  getCachedMeta,
  cacheHtml,
  getCachedHtml,
  getCachedHtmlIds,
  getCacheStats,
  cacheMeta,
  clearCache,
  deleteCachedArticle,
  mergeDeltaIntoCache,
} from '../services/cache';
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
import { RECIPES } from '../recipes';
import { checkQueuePrereqs, queueForCloud } from '../services/cloud-queue';
import { escapeHtml } from '../utils/storage';
import { initBackSwipe, initOverscrollNav, destroyGestures } from '../gestures';

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

export function renderLibrary(root: HTMLElement): void {
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
            <button class="sync-btn" id="syncBtn" title="Sync articles">
              <span class="sync-icon" id="syncIcon">⟳</span>
            </button>
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

        <div class="article-list-container" id="articleList">
          <div class="skeleton-list">
            ${Array(6).fill('<div class="skeleton-item"><div class="skeleton-line long"></div><div class="skeleton-line short"></div></div>').join('')}
          </div>
        </div>

        <div class="sidebar-footer" id="sidebarFooter"></div>
      </aside>

      <div class="resize-handle" id="resizeHandle"></div>

      <main class="reading-pane" id="readingPane">
        <div class="reader-placeholder" id="readerPlaceholder">
          <span class="reader-placeholder-icon">📖</span>
          <p>Select an article to start reading</p>
        </div>
        <div class="reader-content hidden" id="readerContent">
          <div class="article-header-bar" id="articleHeaderBar"></div>
          <iframe
            id="contentFrame"
            class="content-frame"
            sandbox="allow-same-origin"
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
  setupSearch();
  setupFilters();
  setupResizeHandle();
  setupKeyboardShortcuts();
  setupOfflineHandling();
  setupAddUrl();
  populateRecipeFilters();
  setSelectValues();
  setupFab();

  // Load articles
  await loadArticles();
}

function setSelectValues(): void {
  const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;
  const sortSelect = document.getElementById('sortSelect') as HTMLSelectElement;
  filterSelect.value = filterMode;
  sortSelect.value = sortOrder;
}

function populateRecipeFilters(): void {
  const filterSelect = document.getElementById('filterSelect') as HTMLSelectElement;
  for (const recipe of RECIPES) {
    const opt = document.createElement('option');
    opt.value = recipe.id;
    opt.textContent = `${recipe.icon} ${recipe.name}`;
    filterSelect.appendChild(opt);
  }
}

async function loadArticles(): Promise<void> {
  // 1. Show cached articles instantly
  const cached = await getCachedMeta();
  cachedIds = await getCachedHtmlIds();
  if (cached.length > 0) {
    articles = cached;
    renderList();
    updateFooter();
  }

  // 2. Sync in background via delta API
  try {
    setSyncIndicator(true);
    const delta = await syncArticles();

    if (delta.upserted.length > 0 || delta.deleted.length > 0) {
      // Merge changes into cache and update in-memory list
      articles = await mergeDeltaIntoCache(delta.upserted, delta.deleted);

      // Remove deleted IDs from cached HTML set
      for (const id of delta.deleted) cachedIds.delete(id);

      renderList();
      updateFooter();
    } else if (cached.length === 0) {
      // First load with no cache — articles are already in the delta result
      // (delta on first run returns everything, but upserted will be empty
      //  only if there are truly no articles)
      articles = await getCachedMeta();
      renderList();
      updateFooter();
    }
  } catch (err) {
    console.warn('Background sync failed:', err);
    if (cached.length === 0) {
      showToast('Could not load articles. Check your connection.', 'error');
    }
  } finally {
    setSyncIndicator(false);
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
  currentId = id;
  selectedPendingId = null;
  renderList(); // Update active state

  const meta = articles.find(a => a.id === id);
  if (!meta) return;

  // Show loading
  showReaderState('loading');

  // Check cache first
  let html = await getCachedHtml(id);

  if (!html) {
    try {
      html = await downloadArticleHtml(id);
      await cacheHtml(id, html);
      cachedIds.add(id);
      renderList(); // Update cloud badge
      updateFooter();
    } catch (err) {
      console.error('Failed to download article:', err);
      showReaderState('error', 'Failed to download article. Check your connection.');
      return;
    }
  }

  // Render article header
  const headerBar = document.getElementById('articleHeaderBar')!;
  renderArticleHeader(headerBar, meta);

  // Attach header action handlers
  setupArticleActions(meta);

  // Render in iframe
  const frame = document.getElementById('contentFrame') as HTMLIFrameElement;
  // Inject styles: hide extension UI + lock horizontal scroll
  const injectedStyles = `<style>
    .remix-save-fab { display: none !important; }
    html, body {
      max-width: 100vw !important;
      overflow-x: hidden !important;
      touch-action: pan-y pinch-zoom;
      overscroll-behavior: none;
    }
    img, video, iframe, embed, object, table, pre, code, svg {
      max-width: 100% !important;
      overflow-x: auto !important;
      box-sizing: border-box !important;
    }
    pre { white-space: pre-wrap !important; word-break: break-word !important; }
  </style>`;

  // Set onload BEFORE srcdoc — srcdoc iframes can fire load for about:blank
  // before the real content; attaching handlers afterward risks missing it
  frame.onload = () => {
    // iOS Safari can replace the contentDocument after the load event;
    // retry with rAF until the document is fully settled.
    let attempts = 0;
    function trySetup() {
      const doc = frame.contentDocument;
      if (!doc || !doc.body) {
        if (++attempts < 10) requestAnimationFrame(trySetup);
        return;
      }

      fixAnchorLinks(frame);

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
    }
    requestAnimationFrame(trySetup);
  };

  frame.srcdoc = html.replace('</head>', injectedStyles + '</head>');

  showReaderState('content');

  // Update FAB prev/next enabled state
  updateFabState(id);

  // Mobile: show reading pane
  document.body.classList.add('mobile-reading');
}

function goBack(): void {
  destroyGestures();
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
}

async function toggleFavorite(id: string): Promise<void> {
  const meta = articles.find(a => a.id === id);
  if (!meta) return;

  // Optimistic update
  meta.isFavorite = !meta.isFavorite;
  meta.updatedAt = Date.now();

  // Update UI
  const favBtn = document.getElementById('favBtn');
  if (favBtn) {
    const icon = favBtn.querySelector('.fav-icon');
    if (icon) icon.textContent = meta.isFavorite ? '★' : '☆';
    favBtn.classList.toggle('active', meta.isFavorite);
  }
  renderList();

  // Persist to local cache
  await cacheMeta(meta);

  // Push to OneDrive
  try {
    await uploadMeta(meta);
  } catch (err) {
    console.error('Failed to sync favorite:', err);
    // Revert
    meta.isFavorite = !meta.isFavorite;
    meta.updatedAt = Date.now();
    if (favBtn) {
      const icon = favBtn.querySelector('.fav-icon');
      if (icon) icon.textContent = meta.isFavorite ? '★' : '☆';
      favBtn.classList.toggle('active', meta.isFavorite);
    }
    renderList();
    await cacheMeta(meta);
    showToast('Failed to update favorite', 'error');
  }
}

async function confirmDeleteArticle(meta: OneDriveArticleMeta): Promise<void> {
  const title = meta.title.length > 50 ? meta.title.slice(0, 50) + '…' : meta.title;
  if (!confirm(`Delete "${title}"?\n\nThis will remove the article from OneDrive and cannot be undone.`)) {
    return;
  }

  try {
    // Remove from OneDrive
    await deleteArticle(meta.id);
    // Remove from local cache
    await deleteCachedArticle(meta.id);
    // Remove from in-memory list
    articles = articles.filter(a => a.id !== meta.id);
    cachedIds.delete(meta.id);
    // Navigate back
    goBack();
    updateFooter();
    showToast('Article deleted');
  } catch (err) {
    console.error('Failed to delete article:', err);
    showToast('Failed to delete article', 'error');
  }
}

function showReaderState(state: 'placeholder' | 'loading' | 'content' | 'error' | 'progress', errorMsg?: string): void {
  const placeholder = document.getElementById('readerPlaceholder')!;
  const loading = document.getElementById('readerLoading')!;
  const content = document.getElementById('readerContent')!;
  const error = document.getElementById('readerError')!;
  const progress = document.getElementById('readingProgress')!;

  placeholder.classList.toggle('hidden', state !== 'placeholder');
  loading.classList.toggle('hidden', state !== 'loading');
  content.classList.toggle('hidden', state !== 'content');
  error.classList.toggle('hidden', state !== 'error');
  progress.classList.toggle('hidden', state !== 'progress');

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

  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
  });

  document.getElementById('signOutBtn')!.addEventListener('click', async () => {
    await clearCache();
    clearDeltaToken();
    await signOut();
    window.location.reload();
  });

  document.getElementById('settingsBtn')!.addEventListener('click', () => {
    dropdown.classList.add('hidden');
    location.hash = '#settings';
  });

  document.getElementById('clearCacheBtn')!.addEventListener('click', async () => {
    await clearCache();
    clearDeltaToken();
    cachedIds = new Set();
    articles = [];
    renderList();
    updateFooter();
    showToast('Cache cleared — syncing…');
    dropdown.classList.add('hidden');
    await loadArticles();
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
  document.addEventListener('keydown', (e) => {
    // Don't handle if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Escape') {
        (e.target as HTMLElement).blur();
        const clearBtn = document.getElementById('searchClear');
        if (clearBtn) clearBtn.click();
      }
      return;
    }

    const filtered = getFilteredArticles();
    const currentIndex = currentId ? filtered.findIndex(a => a.id === currentId) : -1;

    switch (e.key) {
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
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
        break;
      case 'Escape': // Close reader on mobile
        if (document.body.classList.contains('mobile-reading')) {
          goBack();
        }
        break;
    }
  });
}

function setupOfflineHandling(): void {
  const updateStatus = () => {
    document.body.classList.toggle('is-offline', !navigator.onLine);
  };
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}

function setupSyncButton(): void {
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      await loadArticles();
      showToast('Sync complete');
    });
  }
}

function setupAddUrl(): void {
  const addBtn = document.getElementById('addUrlBtn');
  if (!addBtn) return;

  addBtn.addEventListener('click', async () => {
    // Check prerequisites
    const error = await checkQueuePrereqs();
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

  const recipeOptions = RECIPES.map(r =>
    `<option value="${escapeHtml(r.id)}">${escapeHtml(r.icon + ' ' + r.name)}</option>`
  ).join('');

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
    const customPrompt = (document.getElementById('addUrlPrompt') as HTMLInputElement).value.trim() || undefined;
    const generateImages = (document.getElementById('addUrlImages') as HTMLInputElement).checked;

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
  const footer = document.getElementById('sidebarFooter')!;
  const stats = await getCacheStats();
  const sizeMB = (stats.totalSize / (1024 * 1024)).toFixed(1);
  footer.textContent = `${articles.length} articles · ${stats.count} cached · ${sizeMB} MB`;
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
        await loadArticles();

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
