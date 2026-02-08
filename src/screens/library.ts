import type { OneDriveArticleMeta, SortOrder, FilterMode } from '../types';
import { signOut, getUserDisplayName } from '../services/auth';
import { listArticles, downloadArticleHtml, uploadMeta } from '../services/graph';
import {
  cacheAllMeta,
  getCachedMeta,
  cacheHtml,
  getCachedHtml,
  getCachedHtmlIds,
  getCacheStats,
  cacheMeta,
  clearCache,
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
import { initBackSwipe, initOverscrollNav, destroyGestures } from '../gestures';

let articles: OneDriveArticleMeta[] = [];
let cachedIds = new Set<string>();
let currentId: string | null = null;
let searchQuery = '';
let sortOrder: SortOrder = 'newest';
let filterMode: FilterMode = 'all';
let container: HTMLElement;

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
            <div class="user-menu-wrapper">
              <button class="user-btn" id="userBtn" title="Account menu">
                <span class="user-initials" id="userInitials"></span>
              </button>
              <div class="user-dropdown hidden" id="userDropdown">
                <div class="user-dropdown-name" id="userDropdownName"></div>
                <hr class="user-dropdown-sep">
                <button class="user-dropdown-item" id="clearCacheBtn">🗑️ Clear cache</button>
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
  setupSearch();
  setupFilters();
  setupResizeHandle();
  setupKeyboardShortcuts();
  setupOfflineHandling();
  populateRecipeFilters();
  setSelectValues();

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
  try {
    // Try to load from network
    const metas = await listArticles();
    articles = metas;
    await cacheAllMeta(metas);
  } catch (err) {
    console.warn('Failed to load from network, using cache:', err);
    // Fall back to cached metadata
    articles = await getCachedMeta();
    if (articles.length === 0) {
      showToast('Could not load articles. Check your connection.', 'error');
    }
  }

  cachedIds = await getCachedHtmlIds();
  renderList();
  updateFooter();
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
  renderArticleList(listContainer, filtered, cachedIds, currentId);

  // Attach click handlers
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
}

async function openArticle(id: string): Promise<void> {
  currentId = id;
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
  // Hide any extension-specific UI in the article HTML
  const fabHideStyle = '<style>.remix-save-fab { display: none !important; }</style>';
  frame.srcdoc = html.replace('</head>', fabHideStyle + '</head>');

  frame.onload = () => {
    fixAnchorLinks(frame);
    // Mobile gestures
    if (window.matchMedia('(max-width: 767px)').matches) {
      initOverscrollNav(frame, (dir) => {
        const filtered = getFilteredArticles();
        const idx = filtered.findIndex(a => a.id === id);
        const target = dir === 'prev' ? filtered[idx - 1] : filtered[idx + 1];
        if (target) openArticle(target.id);
      });
    }
  };

  showReaderState('content');

  // Mobile: show reading pane
  document.body.classList.add('mobile-reading');

  // Mobile gestures: back swipe
  if (window.matchMedia('(max-width: 767px)').matches) {
    const readingPane = document.querySelector('.reading-pane') as HTMLElement;
    if (readingPane) {
      destroyGestures();
      initBackSwipe(readingPane, () => goBack());
    }
  }
}

function goBack(): void {
  destroyGestures();
  document.body.classList.remove('mobile-reading');
  currentId = null;
  renderList();
  showReaderState('placeholder');
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

function showReaderState(state: 'placeholder' | 'loading' | 'content' | 'error', errorMsg?: string): void {
  const placeholder = document.getElementById('readerPlaceholder')!;
  const loading = document.getElementById('readerLoading')!;
  const content = document.getElementById('readerContent')!;
  const error = document.getElementById('readerError')!;

  placeholder.classList.toggle('hidden', state !== 'placeholder');
  loading.classList.toggle('hidden', state !== 'loading');
  content.classList.toggle('hidden', state !== 'content');
  error.classList.toggle('hidden', state !== 'error');

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
    await signOut();
    window.location.reload();
  });

  document.getElementById('clearCacheBtn')!.addEventListener('click', async () => {
    await clearCache();
    cachedIds = new Set();
    renderList();
    updateFooter();
    showToast('Cache cleared');
    dropdown.classList.add('hidden');
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
