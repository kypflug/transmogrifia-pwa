# Library of Transmogrifia — Implementation Plan

> Step-by-step build guide for the PWA. Each phase is self-contained and ends with a testable milestone.

---

## Phase 0: Project Scaffolding

**Goal:** Empty Vite + TypeScript PWA that installs and shows a blank page.

### 0.1 Initialize Project

```bash
# From the repo root or a sibling directory
mkdir transmogrifia-pwa && cd transmogrifia-pwa
npm init -y
npm install -D vite typescript vite-plugin-pwa
npm install @azure/msal-browser
```

### 0.2 Project Structure

```
transmogrifia-pwa/
├── index.html                 # SPA entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   ├── manifest.json          # PWA web app manifest
│   ├── favicon.svg
│   └── icons/                 # PWA icons (192, 512)
└── src/
    ├── main.ts                # Entry point: auth check → route
    ├── styles/
    │   ├── global.css         # Reset, design tokens, typography
    │   ├── sign-in.css        # Sign-in screen styles
    │   ├── library.css        # Library layout (adapted from extension)
    │   └── reader.css         # Reader pane / mobile reader view
    ├── services/
    │   ├── auth.ts            # MSAL wrapper
    │   ├── graph.ts           # Microsoft Graph API calls
    │   ├── cache.ts           # IndexedDB article cache
    │   └── preferences.ts     # localStorage prefs (sort, filter, theme)
    ├── screens/
    │   ├── sign-in.ts         # Sign-in screen controller
    │   ├── library.ts         # Library list + reader controller
    │   └── reader.ts          # Reader pane logic (mobile standalone)
    ├── components/
    │   ├── article-list.ts    # Render article list items
    │   ├── article-header.ts  # Article header bar (title, actions)
    │   └── toast.ts           # Toast notification component
    └── types.ts               # Shared types (OneDriveArticleMeta, etc.)
```

### 0.3 Configuration Files

**`tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```

**`vite.config.ts`:**
```typescript
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Library of Transmogrifia',
        short_name: 'Transmogrifia',
        description: 'Read your transmogrified articles anywhere',
        theme_color: '#0078D4',
        background_color: '#F3F3F3',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/graph\.microsoft\.com\/.*/i,
            handler: 'NetworkOnly', // Graph API calls need fresh tokens
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
```

### 0.4 Entry HTML

**`index.html`:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0078D4">
  <meta name="description" content="Read your transmogrified articles anywhere">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <title>Library of Transmogrifia</title>
  <link rel="stylesheet" href="/src/styles/global.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

### Milestone 0
- `npm run dev` serves the page
- PWA install prompt works in Chrome/Edge
- Service worker registers (verified in DevTools > Application)

---

## Phase 1: Authentication

**Goal:** User can sign in with Microsoft, see their name, and sign out.

### 1.1 MSAL Configuration

**`src/services/auth.ts`:**
```typescript
import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';

const CLIENT_ID = '4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2';
// TODO: Update redirect URI for your deployment domain
const REDIRECT_URI = window.location.origin + '/';

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: 'https://login.microsoftonline.com/consumers',
    redirectUri: REDIRECT_URI,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
};

const LOGIN_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access'];

let msalInstance: PublicClientApplication | null = null;

export async function initAuth(): Promise<PublicClientApplication> {
  if (msalInstance) return msalInstance;
  msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  // Handle redirect promise (for loginRedirect flow)
  await msalInstance.handleRedirectPromise();

  return msalInstance;
}

export function getAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}

export async function signIn(): Promise<AccountInfo> {
  const msal = await initAuth();
  const result: AuthenticationResult = await msal.loginPopup({
    scopes: LOGIN_SCOPES,
    prompt: 'select_account',
  });
  return result.account!;
}

export async function signOut(): Promise<void> {
  const msal = await initAuth();
  const account = getAccount();
  if (account) {
    await msal.logoutPopup({ account });
  }
}

export async function getAccessToken(): Promise<string> {
  const msal = await initAuth();
  const account = getAccount();
  if (!account) throw new Error('Not signed in');

  try {
    const result = await msal.acquireTokenSilent({
      scopes: LOGIN_SCOPES,
      account,
    });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      const result = await msal.acquireTokenPopup({
        scopes: LOGIN_SCOPES,
      });
      return result.accessToken;
    }
    throw err;
  }
}

export function isSignedIn(): boolean {
  return getAccount() !== null;
}

export function getUserDisplayName(): string {
  const account = getAccount();
  return account?.name || account?.username || '';
}
```

### 1.2 Sign-In Screen

**`src/screens/sign-in.ts`:**
```typescript
import { signIn } from '../services/auth';

export function renderSignIn(
  container: HTMLElement,
  onSuccess: () => void
): void {
  container.innerHTML = `
    <div class="sign-in-screen">
      <div class="sign-in-card">
        <div class="sign-in-brand">
          <span class="brand-icon">📦</span>
          <h1>Library of Transmogrifia</h1>
        </div>
        <p class="sign-in-tagline">Your transmogrified articles, anywhere.</p>
        <button class="sign-in-btn" id="signInBtn">
          <svg width="20" height="20" viewBox="0 0 21 21">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          Sign in with Microsoft
        </button>
        <p class="sign-in-footnote">
          Requires the <strong>Transmogrifier</strong> extension for article creation.
        </p>
      </div>
    </div>
  `;

  container.querySelector('#signInBtn')!.addEventListener('click', async () => {
    const btn = container.querySelector('#signInBtn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signIn();
      onSuccess();
    } catch (err) {
      console.error('Sign-in failed:', err);
      btn.disabled = false;
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 21 21">
        <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
        <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
        <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
        <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
      </svg> Sign in with Microsoft`;
    }
  });
}
```

### 1.3 Main Entry Router

**`src/main.ts`:**
```typescript
import { initAuth, isSignedIn } from './services/auth';
import { renderSignIn } from './screens/sign-in';
import { renderLibrary } from './screens/library';

const app = document.getElementById('app')!;

async function boot() {
  await initAuth();

  if (isSignedIn()) {
    renderLibrary(app);
  } else {
    renderSignIn(app, () => renderLibrary(app));
  }
}

boot().catch(err => {
  console.error('Boot failed:', err);
  app.innerHTML = '<p>Failed to initialize. Please reload.</p>';
});
```

### Milestone 1
- Sign-in button opens Microsoft consent popup
- After sign-in, user's name appears on screen
- Sign-out clears session, returns to sign-in screen
- Refreshing the page keeps user signed in (MSAL cache)

---

## Phase 2: OneDrive Data Access

**Goal:** Fetch article metadata from OneDrive and display the list.

### 2.1 Graph Service

**`src/services/graph.ts`:**
```typescript
import { getAccessToken } from './auth';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER = 'articles';

export interface OneDriveArticleMeta {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  size: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * List all article metadata from OneDrive
 */
export async function listArticles(): Promise<OneDriveArticleMeta[]> {
  const headers = await authHeaders();
  const metas: OneDriveArticleMeta[] = [];

  let url: string | null =
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}:/children` +
    `?$filter=endswith(name,'.json')&$select=name`;

  while (url) {
    const res = await fetch(url, { headers });

    if (!res.ok) {
      if (res.status === 404) return []; // no articles folder yet
      throw new Error(`List articles failed: ${res.status}`);
    }

    const data = await res.json();

    // Download each metadata file
    for (const item of data.value || []) {
      const name: string = item.name;
      if (!name.endsWith('.json')) continue;
      const id = name.replace('.json', '');
      try {
        const meta = await downloadMeta(id, headers);
        metas.push(meta);
      } catch {
        console.warn('Skipping unreadable metadata:', name);
      }
    }

    url = data['@odata.nextLink'] || null;
  }

  return metas;
}

async function downloadMeta(
  id: string,
  headers: Record<string, string>,
): Promise<OneDriveArticleMeta> {
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.json:/content`,
    { headers },
  );
  if (!res.ok) throw new Error(`Download meta failed: ${res.status}`);
  return res.json();
}

/**
 * Download article HTML content
 */
export async function downloadArticleHtml(id: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${id}.html:/content`,
    { headers },
  );
  if (!res.ok) throw new Error(`Download HTML failed: ${res.status}`);
  return res.text();
}

/**
 * Upload updated metadata (for favorite toggle)
 */
export async function uploadMeta(meta: OneDriveArticleMeta): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/special/approot:/${APP_FOLDER}/${meta.id}.json:/content`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(meta, null, 2),
    },
  );
  if (!res.ok) throw new Error(`Upload meta failed: ${res.status}`);
}

/**
 * Fetch user profile
 */
export async function getUserProfile(): Promise<{
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}> {
  const headers = await authHeaders();
  const res = await fetch(`${GRAPH_BASE}/me`, { headers });
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}
```

### 2.2 IndexedDB Cache

**`src/services/cache.ts`:**
```typescript
import type { OneDriveArticleMeta } from './graph';

const DB_NAME = 'TransmogrifiaPWA';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const HTML_STORE = 'html';

let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onerror = () => reject(req.error);

    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(META_STORE)) {
        const store = database.createObjectStore(META_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('isFavorite', 'isFavorite');
        store.createIndex('recipeId', 'recipeId');
      }
      if (!database.objectStoreNames.contains(HTML_STORE)) {
        database.createObjectStore(HTML_STORE); // keyed by article id
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
  });
}

/** Save or update article metadata in cache */
export async function cacheMeta(meta: OneDriveArticleMeta): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Bulk update all metadata (replace entire cache) */
export async function cacheAllMeta(metas: OneDriveArticleMeta[]): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    store.clear();
    for (const meta of metas) store.put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all cached metadata, sorted newest-first */
export async function getCachedMeta(): Promise<OneDriveArticleMeta[]> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META_STORE, 'readonly');
    const index = tx.objectStore(META_STORE).index('createdAt');
    const req = index.openCursor(null, 'prev');
    const results: OneDriveArticleMeta[] = [];

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** Cache article HTML */
export async function cacheHtml(id: string, html: string): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readwrite');
    tx.objectStore(HTML_STORE).put(html, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get cached article HTML (null if not cached) */
export async function getCachedHtml(id: string): Promise<string | null> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readonly');
    const req = tx.objectStore(HTML_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Check if article HTML is cached */
export async function isHtmlCached(id: string): Promise<boolean> {
  return (await getCachedHtml(id)) !== null;
}

/** Get set of all cached HTML article IDs */
export async function getCachedHtmlIds(): Promise<Set<string>> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(HTML_STORE, 'readonly');
    const req = tx.objectStore(HTML_STORE).getAllKeys();
    req.onsuccess = () => resolve(new Set(req.result.map(String)));
    req.onerror = () => reject(req.error);
  });
}

/** Get total cache size estimate */
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
  const metas = await getCachedMeta();
  const cachedIds = await getCachedHtmlIds();
  const cachedMetas = metas.filter(m => cachedIds.has(m.id));
  return {
    count: cachedIds.size,
    totalSize: cachedMetas.reduce((sum, m) => sum + m.size, 0),
  };
}

/** Clear all cached data */
export async function clearCache(): Promise<void> {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([META_STORE, HTML_STORE], 'readwrite');
    tx.objectStore(META_STORE).clear();
    tx.objectStore(HTML_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

### Milestone 2
- After sign-in, article metadata loads from OneDrive
- Article list renders with titles, recipe icons, dates
- Empty state shown when no articles exist
- Cached metadata survives page reload

---

## Phase 3: Library UI

**Goal:** Full library list with search, filter, sort — matching the extension's look and feel.

### 3.1 Design Tokens

Port the extension's CSS custom properties to `global.css`. The extension uses these (from [library.css](../src/library/library.css)):

```css
:root {
  --edge-blue: #0078D4;
  --edge-blue-hover: #106EBE;
  --edge-blue-light: #DEECF9;
  --edge-blue-muted: #EBF3FC;
  --edge-teal: #00A8A8;
  --edge-teal-dark: #038387;
  --edge-green: #107C10;
  --edge-red: #D13438;
  --edge-red-light: #FDE7E9;
  --edge-surface: #FAFAFA;
  --edge-surface-raised: #FFFFFF;
  --edge-surface-sunken: #F3F3F3;
  --edge-border: #E1E1E1;
  --edge-border-subtle: #EBEBEB;
  --edge-text-primary: #1B1B1F;
  --edge-text-secondary: #616161;
  --edge-text-tertiary: #9E9E9E;
  --edge-shadow-sm: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
  --edge-shadow-md: 0 2px 6px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05);
  --edge-radius: 6px;
  --edge-radius-lg: 10px;
  --lib-font: 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif;
}
```

Add dark mode overrides:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --edge-surface: #1B1B1F;
    --edge-surface-raised: #2B2B30;
    --edge-surface-sunken: #111114;
    --edge-border: #3A3A3F;
    --edge-border-subtle: #2E2E33;
    --edge-text-primary: #E5E5E5;
    --edge-text-secondary: #A0A0A0;
    --edge-text-tertiary: #6A6A6A;
  }
}
```

### 3.2 Library Layout

Adapt the extension's `library.html` structure. Key differences:
- Replace `sidebar-brand` with "Library of Transmogrifia" + user menu
- Remove respin modal, delete modal, progress pane, shortcut legend (v1)
- Add "cloud-only" badge to uncached article items
- Add user avatar to header

### 3.3 Article List Rendering

Reuse the extension's `renderList()` logic almost verbatim. Replace `chrome.storage` calls with `localStorage` for preferences. Replace `getAllArticles()` with `getCachedMeta()`.

### 3.4 Recipes Reference

The PWA needs the recipe definitions (icons + names) for filtering and display. Extract a minimal version:

**`src/recipes.ts`:**
```typescript
/** Minimal recipe info for display purposes (no AI prompts needed) */
export interface RecipeInfo {
  id: string;
  name: string;
  icon: string;
}

export const RECIPES: RecipeInfo[] = [
  { id: 'focus',       name: 'Focus',       icon: '🎯' },
  { id: 'reader',      name: 'Reader',      icon: '📖' },
  { id: 'aesthetic',   name: 'Aesthetic',    icon: '🎨' },
  { id: 'illustrated', name: 'Illustrated', icon: '🖼️' },
  { id: 'visualize',   name: 'Visualize',   icon: '📊' },
  { id: 'declutter',   name: 'Declutter',   icon: '✂️' },
  { id: 'interview',   name: 'Interview',   icon: '🎙️' },
  { id: 'custom',      name: 'Custom',      icon: '⚗️' },
];

export function getRecipe(id: string): RecipeInfo | undefined {
  return RECIPES.find(r => r.id === id);
}
```

### Milestone 3
- Full library list with search, filter by recipe, sort
- Articles show recipe icon, relative date, favorite star
- Cloud-only badge visible on uncached articles
- Responsive: sidebar fills screen on mobile
- Design matches extension's Fluent aesthetic

---

## Phase 4: Article Reader

**Goal:** Open articles, render in sandboxed iframe, toggle favorites.

### 4.1 Article Loading Flow

```
User clicks article
  → Is HTML cached in IndexedDB?
    → YES: Load from cache, render immediately
    → NO: Show loading spinner, download from OneDrive, cache, render
```

### 4.2 Reader Implementation

**Key logic (in `src/screens/library.ts`):**
```typescript
async function openArticle(id: string): Promise<void> {
  // Show loading state
  showReaderLoading();

  // Check cache first
  let html = await getCachedHtml(id);

  if (!html) {
    // Download from OneDrive
    try {
      html = await downloadArticleHtml(id);
      await cacheHtml(id, html);
      // Update the cloud badge in the list
      updateItemCachedState(id, true);
    } catch (err) {
      showReaderError('Failed to download article. Check your connection.');
      return;
    }
  }

  // Render in iframe
  const frame = document.getElementById('contentFrame') as HTMLIFrameElement;

  // Hide the save FAB (not relevant in PWA context)
  const fabHideStyle = '<style>.remix-save-fab { display: none !important; }</style>';
  frame.srcdoc = html.replace('</head>', fabHideStyle + '</head>');

  showReaderContent(currentMeta);
}
```

### 4.3 Favorite Toggle

```typescript
async function toggleFavorite(id: string): Promise<void> {
  const meta = articles.find(a => a.id === id);
  if (!meta) return;

  // Optimistic update
  meta.isFavorite = !meta.isFavorite;
  meta.updatedAt = Date.now();
  renderFavoriteButton(meta.isFavorite);
  renderList();

  // Persist to cache
  await cacheMeta(meta);

  // Push to OneDrive
  try {
    await uploadMeta(meta);
  } catch (err) {
    // Revert on failure
    meta.isFavorite = !meta.isFavorite;
    meta.updatedAt = Date.now();
    renderFavoriteButton(meta.isFavorite);
    renderList();
    await cacheMeta(meta);
    showToast('Failed to update favorite');
  }
}
```

### 4.4 Mobile Reader Navigation

On mobile (<768px), selecting an article slides in the reader view:
```css
/* Mobile: stacked layout with slide transition */
@media (max-width: 767px) {
  .library-layout {
    position: relative;
    overflow: hidden;
  }

  .sidebar {
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
  }

  .reading-pane {
    position: absolute;
    inset: 0;
    transform: translateX(100%);
    transition: transform 0.25s ease;
    z-index: 10;
  }

  body.mobile-reading .reading-pane {
    transform: translateX(0);
  }

  .resize-handle { display: none; }
  .mobile-back { display: flex !important; }
}
```

### 4.5 Anchor Link Fixing

Port directly from extension's `fixAnchorLinks()`:
```typescript
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
  } catch { /* cross-origin — ignore */ }
}
```

### Milestone 4
- Clicking an article downloads and renders it
- Cached articles open instantly on repeat
- Favorite toggle syncs to OneDrive
- Mobile: tap article → reader slides in; back button returns to list
- Anchor links within articles work correctly

---

## Phase 5: Offline & PWA Polish

**Goal:** Works offline for cached articles, installable, polished UX.

### 5.1 Offline Detection

```typescript
function setupOfflineHandling(): void {
  const updateOnlineStatus = () => {
    document.body.classList.toggle('is-offline', !navigator.onLine);
  };

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}
```

Show a subtle offline banner:
```css
.offline-banner {
  display: none;
  background: var(--edge-red-light);
  color: var(--edge-red);
  text-align: center;
  padding: 4px;
  font-size: 12px;
}

body.is-offline .offline-banner {
  display: block;
}
```

### 5.2 Pull-to-Refresh (Mobile)

Implement a simple pull-to-refresh on the article list:
- Track touch start/move/end on the article list container
- When pulled down > 60px and released, trigger `refreshArticles()`
- Show a spinner during refresh

### 5.3 Loading States

| State | Display |
|-------|---------|
| Initial load (fetching metadata) | Skeleton list items (pulsing gray rectangles) |
| Opening uncached article | Spinner in reader pane + "Downloading…" |
| Refreshing article list | Pull-to-refresh spinner (mobile) or header spinner (desktop) |
| Error | Inline error message with retry option |

### 5.4 User Menu

Top-right user button showing:
- User initials in a circle (or first letter)
- Dropdown: display name, email, "Sign out", "Clear cache", "About"

### 5.5 App Install Banner

`vite-plugin-pwa` handles the install prompt automatically. Add a custom install button in settings or header for discoverability.

### Milestone 5
- App works offline for cached articles
- "You're offline" banner shows when disconnected
- Cloud-only articles show "Download to read offline" prompt
- Pull-to-refresh on mobile
- Clean install experience on iOS / Android / Desktop

---

## Phase 6: Theme & Visual Polish

**Goal:** Dark mode, sepia mode, visual consistency with the extension.

### 6.1 Theme Toggle

Three themes: Light (default), Dark, Sepia — stored in `localStorage`.

```typescript
type Theme = 'light' | 'dark' | 'sepia' | 'system';

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;

  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem('theme', theme);

  // Update meta theme-color
  const colors = { light: '#0078D4', dark: '#1B1B1F', sepia: '#F4ECD8' };
  document.querySelector('meta[name="theme-color"]')!
    .setAttribute('content', colors[resolved] || colors.light);
}
```

### 6.2 Sepia Theme Tokens

```css
[data-theme="sepia"] {
  --edge-surface: #F4ECD8;
  --edge-surface-raised: #FBF6EB;
  --edge-surface-sunken: #EDE4CE;
  --edge-border: #D4C9A8;
  --edge-border-subtle: #E0D7C0;
  --edge-text-primary: #3E3424;
  --edge-text-secondary: #7A6E5A;
  --edge-text-tertiary: #A09480;
}
```

### Milestone 6
- Three themes work correctly
- System preference auto-detection
- Theme persists across sessions
- Status bar color matches theme on mobile

---

## Phase 7: Deployment & App Registration

**Goal:** Published and accessible at a real URL.

### 7.1 Azure AD App Registration Update

1. Go to [Azure Portal](https://portal.azure.com) → App registrations → Transmogrifier app
2. Under **Authentication** → **Add a platform** → **Single-page application**
3. Add redirect URI: `https://<your-domain>/`
4. Also add `http://localhost:5173/` for local development
5. Save

### 7.2 Azure Static Web Apps Deployment

```yaml
# .github/workflows/deploy-pwa.yml
name: Deploy PWA

on:
  push:
    branches: [main]
    paths: ['transmogrifia-pwa/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: |
          cd transmogrifia-pwa
          npm ci
          npm run build
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_SWA_TOKEN }}
          app_location: transmogrifia-pwa/dist
          skip_app_build: true
```

### 7.3 SWA Config

**`transmogrifia-pwa/staticwebapp.config.json`:**
```json
{
  "navigationFallback": {
    "rewrite": "/index.html"
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://graph.microsoft.com https://login.microsoftonline.com; frame-src 'self' blob:; img-src 'self' data: blob: https:;"
  }
}
```

### Milestone 7
- PWA accessible at public URL
- Install works on mobile and desktop
- Auth flow completes with production redirect URI
- All articles readable end-to-end

---

## Task Checklist

| # | Task | Phase | Effort |
|---|------|-------|--------|
| 1 | Scaffold Vite + TypeScript + PWA project | 0 | 1h |
| 2 | Create PWA manifest + icons | 0 | 30m |
| 3 | Implement MSAL auth service | 1 | 2h |
| 4 | Build sign-in screen | 1 | 1h |
| 5 | Build main router (auth → library) | 1 | 30m |
| 6 | Implement Graph service (list/download/upload) | 2 | 2h |
| 7 | Implement IndexedDB cache service | 2 | 2h |
| 8 | Port design tokens + global styles | 3 | 1h |
| 9 | Build library layout (sidebar + reading pane) | 3 | 3h |
| 10 | Implement search/filter/sort | 3 | 2h |
| 11 | Build article reader (iframe + loading) | 4 | 2h |
| 12 | Implement favorite toggle with sync | 4 | 1h |
| 13 | Mobile responsive layout + back nav | 4 | 2h |
| 14 | Keyboard shortcuts (j/k/f//) | 4 | 1h |
| 15 | Offline detection + banner | 5 | 1h |
| 16 | Skeleton loading states | 5 | 1h |
| 17 | User menu (sign-out, clear cache) | 5 | 1h |
| 18 | Pull-to-refresh (mobile) | 5 | 1h |
| 19 | Dark mode + sepia theme | 6 | 2h |
| 20 | Register redirect URI in Azure AD | 7 | 30m |
| 21 | Set up Azure Static Web Apps deploy | 7 | 1h |
| 22 | End-to-end testing | 7 | 2h |
|   | **Total** | | **~28h** |

---

## Key Decisions & Risks

### Decisions

| Decision | Choice | Alternative Considered |
|----------|--------|----------------------|
| Same Azure AD app ID | Yes — shares AppFolder | Separate app ID (different folder, needs broader scope) |
| MSAL.js vs manual PKCE | MSAL.js | Manual (more control, more code, less reliable) |
| Framework | None (vanilla TS) | React/Preact (heavier, doesn't match extension style) |
| Styling | CSS custom properties, no preprocessor | Tailwind (adds build step, diverges from extension) |
| State management | Module-level variables (like extension) | Store library (overkill for read-only app) |

### Risks

| Risk | Mitigation |
|------|-----------|
| AppFolder scope requires same client ID | Document clearly; test with both setups |
| Large libraries (500+ articles) slow to load metadata | Paginate list API; show loading progress; batch downloads |
| MSAL popup blocked on mobile browsers | Offer `loginRedirect` as fallback |
| Generated article HTML may reference external resources | Articles are self-contained by design; CSP allows `https:` images |
| Service worker cache grows unbounded | Track cache size; offer "clear cache" in settings; auto-evict oldest |
