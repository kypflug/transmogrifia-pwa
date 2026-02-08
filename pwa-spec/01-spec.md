# Library of Transmogrifia — Product Specification

> A standalone Progressive Web App for reading Transmogrifier articles on any device.

## 1. Overview

**Library of Transmogrifia** is a read-only companion PWA for the Transmogrifier browser extension. It lets users sign in with their Microsoft account and browse, search, and read their saved transmogrifications from any device — phone, tablet, or desktop — without needing the extension installed.

### 1.1 Goals

- Give extension users mobile/cross-device access to their transmogrified articles
- Provide a fast, responsive, installable reading experience
- Reuse the existing OneDrive storage layer with zero migration
- Work offline for previously-viewed articles

### 1.2 Non-Goals (v1)

- No article generation/transmogrification (read-only)
- No respin functionality
- No editing or annotation
- No push notifications
- No article sharing/collaboration

---

## 2. Architecture

### 2.1 Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript (strict) | Match extension codebase |
| Build tool | Vite | Match extension; fast builds, PWA plugin |
| UI framework | Vanilla TS + CSS | Match extension; minimal bundle |
| Auth | MSAL.js 2.x (`@azure/msal-browser`) | Microsoft's official SPA auth library; handles PKCE, token caching, refresh automatically |
| Data access | Microsoft Graph REST API | Same endpoints the extension uses |
| Local storage | IndexedDB (article cache) + localStorage (preferences) | Offline-first reading |
| PWA | `vite-plugin-pwa` (Workbox) | Service worker generation, manifest, offline caching |
| Hosting | Azure Static Web Apps or GitHub Pages | Free/cheap, HTTPS, custom domain |

### 2.2 High-Level Architecture

```
┌──────────────────────────────────────────────────┐
│                  Browser (PWA)                    │
│                                                   │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │  Auth    │  │ OneDrive │  │  Article Cache   │ │
│  │ (MSAL)  │──│  Service │──│  (IndexedDB)     │ │
│  └─────────┘  └──────────┘  └──────────────────┘ │
│       │                           │               │
│  ┌────▼───────────────────────────▼──────────┐   │
│  │              UI Layer                      │   │
│  │  ┌──────────┐  ┌───────────┐  ┌────────┐  │   │
│  │  │ Sign-In  │  │ Library   │  │ Reader │  │   │
│  │  │ Screen   │  │ (list)    │  │ (view) │  │   │
│  │  └──────────┘  └───────────┘  └────────┘  │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │           Service Worker (Workbox)         │   │
│  │  • App shell caching (precache)            │   │
│  │  • Article HTML caching (runtime)          │   │
│  └───────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
   ┌──────────────┐    ┌──────────────┐
   │ login.ms.com │    │ graph.ms.com │
   │  (OAuth2)    │    │  (OneDrive)  │
   └──────────────┘    └──────────────┘
```

### 2.3 Data Model (reused from extension)

The extension stores articles in OneDrive under `Apps/Transmogrifier/articles/`:

```
/drive/special/approot/articles/
  ├── {id}.json   ← metadata (OneDriveArticleMeta)
  └── {id}.html   ← full rendered HTML content
```

**`OneDriveArticleMeta`** (JSON, ~500 bytes each):
```typescript
interface OneDriveArticleMeta {
  id: string;
  title: string;
  originalUrl: string;
  recipeId: string;
  recipeName: string;
  createdAt: number;    // epoch ms
  updatedAt: number;    // epoch ms
  isFavorite: boolean;
  size: number;         // HTML size in bytes
}
```

**Article HTML** (typically 20KB–2MB): Complete self-contained HTML documents with inline styles, generated by the extension's AI recipes.

### 2.4 Storage Strategy

| Store | Contents | Purpose |
|-------|----------|---------|
| MSAL cache (localStorage) | OAuth tokens | Automatic via MSAL.js |
| IndexedDB `TransmogrifiaPWA` | Downloaded article HTML + metadata | Offline reading, fast re-opens |
| localStorage | UI preferences (sort, filter, theme, sidebar width) | Persist settings |

**Lazy download pattern** (same as extension):
1. On sign-in / refresh: fetch all `.json` metadata files → build article index
2. Article HTML is only downloaded when the user opens it
3. Once downloaded, HTML is cached in IndexedDB for offline access
4. Metadata refresh uses list endpoint; delta API optional for v2

---

## 3. Authentication

### 3.1 App Registration

The PWA needs its own redirect URI registered in the **same Azure AD app** (`4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2`) used by the extension, or a new app registration. Using the same app is simpler since articles are stored in the same AppFolder.

**Required redirect URI:** `https://<pwa-domain>/auth/callback` (SPA type)

**Scopes** (identical to extension):
- `Files.ReadWrite.AppFolder` — access articles in OneDrive app folder
- `User.Read` — display name / email
- `offline_access` — refresh tokens

> **Note:** `Files.ReadWrite.AppFolder` scopes articles to the *same* app registration's folder. If we use the same client ID, the PWA sees the extension's articles automatically. If we use a different client ID, articles would be in a different AppFolder and we'd need `Files.ReadWrite` instead.

**Recommendation:** Register the PWA redirect URI on the existing app registration. This gives seamless access to the same articles with the minimal-privilege `AppFolder` scope.

### 3.2 Auth Flow

```
User clicks "Sign in with Microsoft"
  → MSAL.js loginPopup() or loginRedirect()
    → Azure AD consent screen
      → Authorization code returned
        → MSAL exchanges for tokens (PKCE, automatic)
          → Access token cached; used for Graph calls
```

MSAL.js handles:
- PKCE challenge/verifier generation
- Token caching in localStorage/sessionStorage
- Silent token refresh via hidden iframe
- Multi-account support (not needed v1, but free)

### 3.3 Sign-Out

- Call `msalInstance.logoutPopup()` or `logoutRedirect()`
- Clear IndexedDB article cache
- Return to sign-in screen

---

## 4. User Interface

### 4.1 Screen Flow

```
[Sign-In Screen] → [Library View] ↔ [Reader View]
                                    ↕ (mobile: stacked)
```

Three states:
1. **Sign-In Screen** — shown when not authenticated
2. **Library View** — article list with search/filter/sort
3. **Reader View** — sandboxed article content in iframe

On desktop (≥768px): two-pane layout (list + reader side by side), like the extension.
On mobile (<768px): single-pane with navigation between list and reader.

### 4.2 Sign-In Screen

Minimal branded landing page:

```
┌──────────────────────────────────┐
│                                  │
│       📦 Library of              │
│       Transmogrifia              │
│                                  │
│  Your transmogrified articles,   │
│  anywhere.                       │
│                                  │
│  ┌──────────────────────────┐    │
│  │ 🔑 Sign in with Microsoft│    │
│  └──────────────────────────┘    │
│                                  │
│  Requires the Transmogrifier     │
│  extension for article creation. │
│                                  │
└──────────────────────────────────┘
```

### 4.3 Library View (Article List)

Adapted from the extension's library sidebar. Key differences:
- **No pending remixes** (read-only app)
- **No respin button** (no AI access)
- **No export-to-file button** (could add later)
- **Cloud badge** on articles not yet downloaded locally
- **Pull-to-refresh** on mobile

#### Header Bar
```
┌─────────────────────────────────────────────┐
│ 📦 Library of Transmogrifia    [👤 User] [⚙]│
└─────────────────────────────────────────────┘
```
- User avatar/initials → sign-out menu
- Settings gear → preferences (theme, etc.)

#### Controls (search + filter + sort)
Identical to extension:
```html
<div class="search-box">
  <span class="search-icon">🔍</span>
  <input type="text" placeholder="Search articles…">
  <button class="search-clear hidden">✕</button>
</div>
<div class="filter-row">
  <select id="filterSelect">
    <option value="all">All Articles</option>
    <option value="favorites">★ Favorites</option>
    <option value="downloaded">📥 Downloaded</option>
    <!-- Recipe filters populated by JS -->
  </select>
  <select id="sortSelect">
    <option value="newest">Newest first</option>
    <option value="oldest">Oldest first</option>
    <option value="alpha">A → Z</option>
  </select>
</div>
```

#### Article List Item

```
┌──────────────────────────────────┐
│ ★ Article Title That May Be     │
│   Quite Long and Wraps          │
│ 🎯 Focus · 2h ago        ☁️     │
└──────────────────────────────────┘
```
- `☁️` badge on items not yet downloaded (cloud-only)
- `★` for favorites (gold star)
- Recipe icon + name
- Relative date

#### Footer
```
12 articles · 4.2 MB cached
```

### 4.4 Reader View

Simplified from the extension's reading pane:

#### Article Header
```
┌──────────────────────────────────────────────────┐
│ Article Title                                     │
│ example.com · 🎯 Focus · Jan 15                  │
│                              [☆ Fav] [🔗 Orig]   │
└──────────────────────────────────────────────────┘
```

Actions available:
- **Toggle favorite** — updates `.json` metadata in OneDrive
- **Open original** — opens `originalUrl` in new tab
- **Share** (mobile) — Web Share API for the original URL
- **Back** (mobile) — return to list

Actions NOT available (v1):
- Export/download (could add later via Blob URL)
- Respin (no AI)
- Delete (destructive; leave to extension)
- Open in new tab (already in a tab)

#### Content Area
Same sandboxed iframe approach as the extension:
```html
<iframe
  id="contentFrame"
  class="content-frame"
  sandbox="allow-same-origin allow-scripts"
></iframe>
```
Content loaded via `contentFrame.srcdoc = article.html`.

### 4.5 Responsive Breakpoints

| Breakpoint | Layout | Behavior |
|------------|--------|----------|
| ≥ 1024px | Two-pane, resizable sidebar | Desktop full experience |
| 768–1023px | Two-pane, narrower sidebar, hide action labels | Tablet |
| < 768px | Single-pane, stacked | Mobile; back button navigation |

### 4.6 Theme Support

Support light/dark/sepia themes via CSS custom properties. Default follows `prefers-color-scheme`. The extension already defines a thorough Fluent-based design token system that we can reuse.

### 4.7 Keyboard Shortcuts

Replicate the extension's keyboard navigation:
- `j` / `k` — next / previous article
- `f` — toggle favorite
- `/` — focus search
- `Escape` — close reader (mobile), clear search

---

## 5. Offline Support

### 5.1 Service Worker Strategy

Using Workbox via `vite-plugin-pwa`:

| Resource | Strategy | Notes |
|----------|----------|-------|
| App shell (HTML, CSS, JS) | **Precache** | Versioned at build time |
| Fonts, icons | **Cache-first** | Long-lived |
| Article metadata list | **Network-first** | Fall back to cached index |
| Article HTML content | **Cache-first** (after first download) | Stored in IndexedDB directly |
| Graph API calls | **Network-only** | Auth tokens required |

### 5.2 Offline Behavior

- **Signed in, has cached articles:** Full reading experience for cached articles; cloud-only articles show "Download required" state
- **Signed in, offline:** Can read cached articles; metadata list is stale but usable from IndexedDB cache
- **Not signed in, offline:** Sign-in screen with "You're offline" message

### 5.3 Cache Management

- Article HTML is cached in IndexedDB when first opened
- User can clear cache from settings
- Optional: auto-evict articles older than N days or over a size limit
- Show cache size in footer: `12 articles · 4.2 MB cached`

---

## 6. API Integration

### 6.1 Microsoft Graph Endpoints Used

All endpoints are identical to the extension's `onedrive-service.ts`:

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List article metadata | GET | `/me/drive/special/approot:/{folder}:/children?$filter=endswith(name,'.json')` |
| Download metadata JSON | GET | `/me/drive/special/approot:/{folder}/{id}.json:/content` |
| Download article HTML | GET | `/me/drive/special/approot:/{folder}/{id}.html:/content` |
| Update metadata (favorite) | PUT | `/me/drive/special/approot:/{folder}/{id}.json:/content` |
| User profile | GET | `/me` |

Where `{folder}` = `articles` (the `APP_FOLDER` constant from the extension).

### 6.2 API Access Pattern

```typescript
// Pseudocode for article loading
async function loadArticleIndex(): Promise<OneDriveArticleMeta[]> {
  const token = await msalInstance.acquireTokenSilent({ scopes });
  const headers = { Authorization: `Bearer ${token.accessToken}` };

  // List all .json files in the articles folder
  let url = `${GRAPH_BASE}/me/drive/special/approot:/articles:/children?$filter=endswith(name,'.json')&$select=name`;
  const metas: OneDriveArticleMeta[] = [];

  while (url) {
    const res = await fetch(url, { headers });
    const data = await res.json();

    for (const item of data.value) {
      const id = item.name.replace('.json', '');
      const metaRes = await fetch(
        `${GRAPH_BASE}/me/drive/special/approot:/articles/${id}.json:/content`,
        { headers }
      );
      metas.push(await metaRes.json());
    }

    url = data['@odata.nextLink'] || null;
  }

  return metas;
}
```

### 6.3 Error Handling

| Scenario | Handling |
|----------|----------|
| 401 Unauthorized | MSAL auto-refreshes; if refresh fails → sign-in screen |
| 404 folder not found | Show "No articles yet" empty state |
| Network error | Show cached data with "offline" banner |
| Rate limiting (429) | Retry with backoff |
| Large library (100+ articles) | Paginate metadata loading; show progress |

---

## 7. Favorite Toggle (Write Operation)

The only write operation in v1: toggling an article's favorite status.

1. Update local IndexedDB cache immediately (optimistic)
2. Upload updated `.json` metadata to OneDrive
3. If upload fails → revert local state, show error toast

This keeps the favorite in sync with the extension, since both read/write the same `.json` file.

---

## 8. Performance Considerations

### 8.1 Initial Load

- **App shell:** < 100KB gzipped (vanilla TS, no framework)
- **Metadata fetch:** One Graph API call to list files, then N calls for N articles' metadata. For large libraries, batch with `$batch` endpoint (v2).
- **Target:** Article list visible within 2s of sign-in on broadband

### 8.2 Article Opening

- **Cached:** Instant (IndexedDB read)
- **First open:** Download HTML → cache → render. Typical article is 20–200KB.
- **Iframe rendering:** Same approach as extension; self-contained HTML renders immediately

### 8.3 Optimization Opportunities (v2)

- Use Graph `$batch` API to download multiple metadata files in one request
- Delta API for incremental sync (already implemented in extension, can port)
- Background sync via service worker periodic sync API
- Thumbnail extraction for list view

---

## 9. Security

- **OAuth2 PKCE only** — no client secrets in browser code
- **`Files.ReadWrite.AppFolder` scope** — can only access the app's own folder, not user's full OneDrive
- **Sandboxed iframe** for article content — `allow-same-origin allow-scripts` (matches extension)
- **CSP headers** — restrict to self + Graph API + login.microsoftonline.com
- **No article content sent to any server** — all rendering is local
- **Tokens stored in MSAL cache** (localStorage) — standard pattern for SPAs

---

## 10. Deployment

### 10.1 Build Output

Static files (HTML, CSS, JS, service worker, manifest) — deploy anywhere that serves HTTPS.

### 10.2 Hosting Options

| Option | Pros | Cons |
|--------|------|------|
| **Azure Static Web Apps** | Free tier, custom domain, GitHub Actions CI/CD | Azure account needed |
| **GitHub Pages** | Free, simple | No server-side headers control |
| **Vercel** | Free, fast builds | Another account |
| **Cloudflare Pages** | Free, edge caching | Another account |

**Recommendation:** Azure Static Web Apps — aligns with the Azure OpenAI / Microsoft ecosystem.

### 10.3 Domain

Suggested: `transmogrifia.app` or `library.transmogrifier.app` or subdomain of project site.

The redirect URI in the Azure AD app registration must match the deployment domain.

---

## 11. Future Enhancements (v2+)

- **Delta sync** — port the extension's delta API integration for incremental updates
- **Background sync** — use Periodic Background Sync API to refresh metadata when app is closed
- **Article download** — save article HTML as file (Blob URL download)
- **Delete articles** — with confirmation; sync delete to OneDrive
- **Search within article** — Ctrl+F pass-through to iframe
- **Batch metadata loading** — Graph `$batch` API for faster initial load
- **Thumbnail previews** — extract first image or generate preview
- **Cross-PWA article sharing** — Web Share Target API
- **Push notifications** — notify when new articles appear in OneDrive
- **Multiple account support** — MSAL supports this natively
