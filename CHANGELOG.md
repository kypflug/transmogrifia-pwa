# Changelog

All notable changes to Library of Transmogrifia will be documented in this file.

---

## [Unreleased]

### Changed

- **Article-list origin metadata** — Sidebar list items now show the source hostname before recipe and relative age, matching the reader header-style metadata pattern (`origin.com · Reader · 1d ago`).

---

## [1.5.10] — 2026-02-18

### Fixed

- **Draggable startup loading/error in WCO mode** — Added a dedicated Window Controls Overlay drag strip for both boot loading and boot error screens so the installed desktop PWA window can be moved while auth recovery is in progress.

---

## [1.5.9] — 2026-02-17

### Changed

- **Hybrid fast recipe** — Fast recipe now uses cloud AI for content extraction/deduplication/detritus removal (`ai-extract` render mode). Recipe ID changed from `fast-no-inference` to `fast`; backward compatibility alias preserved in `getRecipe()`.

- **Core 0.1.27** — Updated `@kypflug/transmogrifier-core` for `ai-extract` render mode and renamed fast recipe.

---

## [1.5.8] — 2026-02-17

### Fixed

- **Stale deleted articles now self-heal on open** — When an article is deleted remotely and opening it returns Graph 404/410, the app now evicts the stale local entry (metadata + cached content), shows a clear "no longer available" message, and triggers a background resync.

- **Delta metadata race now captures mid-sync deletions** — If a metadata file is deleted between delta listing and batch metadata download, 404/410 responses are now treated as deletions (not transient failures), so reconcile paths remove the article correctly.

- **Sync freshness semantics tightened** — `lastSyncTime` and `sync-complete` broadcasts are now emitted only on successful sync/reconcile, preventing failed syncs from being marked as fresh and reducing long-lived stale library state.

---

## [1.5.7] — 2026-02-17

### Added

- **Blocked-source badge in Library list** — Articles marked with `source-fetch-blocked-401-403` now show a warning badge so users can identify failed saves quickly.

- **Blocked-source warning in reader header** — Reader header now displays a clear warning + direct original URL link for blocked-source fallback articles.

### Changed

- **Blocked-source status surfaced from article metadata** — Reader/list rendering paths now consistently display `rssFallbackReason`-derived status when present.

---

## [1.5.6] — 2026-02-17

### Added

- **Reader progress meter (PWA library + shared viewer)** — Added a thin top reading-progress bar that tracks scroll position inside sandboxed article iframes.

- **Cross-browser iframe scroll-root handling** — Progress calculation now detects whether `documentElement` or `body` is the active scroll container and clamps correctly for non-scrollable documents.

- **Reader-state progress lifecycle resets** — Progress tracking/listeners reset cleanly when leaving article-content state (placeholder, loading, error, in-progress cloud job), preventing stale bars between article switches.

- **Fast recipe default for Add URL flow** — Add URL modal now pre-selects the `fast-no-inference` recipe when available.

### Changed

- **Capability-aware queue prerequisites** — Cloud queue AI prerequisite checks now run only for recipes that require AI, allowing deterministic recipes to queue without AI configuration.

- **Capability-aware queue payloads** — `aiConfig` is now conditionally included only when required by the selected recipe.

- **Shared core contract alignment** — PWA types now re-export ingestion and subscription contracts (`IngestionSource`, `FeedEntryRef`, `FeedSyncCursor`, `FeedSubscription`) from core `0.1.25`.

---

## [1.5.5] — 2026-02-17

### Fixed

- **iPadOS standalone auth detection hardening** — `isIosStandalone()` now treats desktop-UA iPadOS (`MacIntel` + touch) as iOS standalone, so the iOS cold-start recovery path continues to skip `ssoSilent` iframe attempts that are unreliable in installed PWAs.

- **Auth recovery debug breadcrumbs** — Added explicit `[Auth]` breadcrumbs for (1) desktop-UA iPadOS standalone detection and (2) `ssoSilent` skip decisions, making Safari remote-inspector cold-start diagnostics easier.

---

## [1.5.4] — 2026-02-17

### Fixed

- **iOS PWA: blank screen on cold restart** — When iOS kills the WKWebView process after backgrounding, the app now shows a loading spinner immediately instead of a blank white/grey screen for 10+ seconds while auth resolves.

- **iOS PWA: faster auth recovery** — Skipped `ssoSilent` recovery on iOS standalone PWAs where it always times out (~6 seconds wasted) due to third-party iframe restrictions. Recovery now falls directly to the redirect-based path.

- **iOS PWA: seamless re-authentication** — When silent token recovery fails but the user was previously signed in, the app now auto-redirects to Microsoft login with the saved `loginHint` instead of requiring the user to manually tap "Sign In". A `sessionStorage` guard prevents redirect loops.

- **iOS PWA: proactive MSAL cache backup** — MSAL cache is now backed up to IndexedDB on `pagehide` and `visibilitychange:hidden` events, giving the backup a chance to persist before iOS kills the process. Previously, backups only ran after explicit auth operations.

---

## [1.5.3] — 2026-02-17

### Changed

- **Documentation: shared core package** — Updated README and Copilot instructions to document that all service-level content (shared types, recipes, crypto, blob-storage helpers, etc.) is authored in the `transmogrifier-infra` monorepo and consumed by both the PWA and extension via the `@kypflug/transmogrifier-core` package. Updated the compatibility contract table to reference core source files instead of extension files.

### Fixed

- **Grid overlap on fullbleed elements** — Recipes that nest full-viewport breakout sections (`.fullbleed` with `calc(50% - 50vw)` margins) inside multi-column grid layouts caused content to overflow its grid cell and overlap the aside column. Added CSS mitigations in both the shared viewer and library reader to contain fullbleed elements within their grid cell.

- **Illustrated hero image left-aligned at wide viewports** — When `max-height: 72vh` combined with `aspect-ratio: 16/9` constrains the hero media container to narrower than the viewport, the block-level `.media` div defaulted to left alignment. Fixed at the recipe layer in `transmogrifier-infra` (hero media now uses `margin: 0 auto`); removed the defensive PWA override added earlier.

- **`cap-reveal` animation class not forced visible** — The `cap-reveal` class used by some recipes for figcaption fade-in animations wasn't included in the sandbox animation override, leaving captions invisible when scripts are blocked. Added to the existing `.io, .reveal, .cap` selector.

---

## [1.5.2] — 2026-02-17

### Fixed

- **Links unclickable in library reader** — External links inside articles were visually clickable but failed to open because the iframe sandbox was missing `allow-popups`. Added the flag to match the shared viewer iframe, which already had it.

- **Mobile overflow on shared pages** — Shared viewer was missing media-clamping CSS rules that the library reader already had (`max-width: 100%` on images, tables, pre, etc.). Ported the full set from `library.ts`, eliminating horizontal scrolling on iPhone and other narrow viewports.

- **Author bio floating outside reading column** — AI-generated CSS sometimes floated byline/author blocks, causing layout issues on desktop. Added defensive CSS guardrails in both the shared viewer and library reader to force author/byline elements to full-width block layout.

### Added

- **Share-time quality heuristics** — `validateShareHtml()` runs lightweight checks before publishing shared articles: warns on duplicate hero images (2+ `<img>` in first 500 chars of body) and trailing recirculation galleries (3+ unrelated images near end of body). Telemetry-only via `console.warn` — does not block sharing.

---

## [1.5.1] — 2026-02-16\n\n### Fixed\n\n- **PWA signed out on every close/reopen (Windows)** — The `try-catch` added around `handleRedirectPromise()` in Fix 1/2 silently swallowed errors from stale MSAL interaction state, causing `isSignedIn()` to return false and showing the sign-in screen instead of recovering. Three changes: (1) `cleanUpStaleState()` now removes ALL MSAL temp/interaction keys (not just `interaction.status` and `request.params`), preventing recurring stale state cycles; (2) MSAL instance is always re-created after a `handleRedirectPromise` failure (not only when an account hint exists); (3) `boot()` now attempts silent auth recovery whenever an account hint exists in localStorage, not only after an IndexedDB cache restore, so Windows PWA reopens recover gracefully from transient MSAL errors.\n\n---\n\n## [1.5.0] — 2026-02-16

### Fixed

- **Coordinator cleanup leaked on route switch** — `teardownScreenListeners` only ran when `renderLibrary` re-entered, not when navigating to settings. Exported the function and call it from `route()` before rendering any screen, ensuring coordinator subscriptions and write queue are properly torn down on every route change.

- **Cross-tab refresh ignored empty cache** — `refreshFromCache()` in sync-coordinator skipped the emit when the cache was empty, leaving stale article lists visible in other tabs after destructive operations. Now always emits `articles-updated`, even with an empty list.

- **Sign-out did not broadcast auth-changed** — The sign-out handler cleared cache and reloaded without broadcasting `auth-changed signedIn: false`. Other tabs had no notification of the sign-out until their next Graph call failed. Now broadcasts before reload.

- **Share/unshare 412 conflicts gave generic error** — When `uploadMeta` hit an ETag 412 during share/unshare (no `mergeFn` path), the user saw a generic failure toast. Now shows an actionable message ("Sync and retry") and logs the 412 with `[Sync]` prefix for observability.

- **Auth cascade never redirected for re-auth** (Fix 1) — After a `BrowserAuthError` retry with `forceRefresh` failed, the catch block fell through to an `InteractionRequiredAuthError` type check that never matched, so `acquireTokenRedirect` was never called. Users were stuck signed out with no recovery path. Now explicitly calls `acquireTokenRedirect` after the retry fails.

- **MSAL backup restored stale interaction state** (Fix 2) — `msal-cache-backup.ts` was snapshotting `interaction.status` and `request.params` keys. Restoring these after an iOS process kill caused `interaction_in_progress` errors, blocking sign-in. Both backup and restore now skip these transient keys.

- **Delta token lost on iOS** (Fix 3) — Delta token was stored in localStorage, which iOS evicts aggressively. Moved to IndexedDB `settings` store with a one-time migration from localStorage (avoids forcing a full sync on first launch after deployment).

- **`_index.json` treated as an article** (Fix 4) — The `.json` filter in `syncArticles`, `bootstrapDeltaToken`, and `listArticles` didn't exclude `_index.json`. Added `if (name.startsWith('_')) continue;` in all three loops to eliminate the phantom `_index` article.

- **`bootstrapDeltaToken` saved delta token prematurely** (Fix 5) — If metadata downloads partially failed, the token was already saved, making those articles permanently invisible to future syncs. Moved delta token save to after all downloads complete; only saves if zero failures.

- **`reconcileCache` destructively replaced cache on index sync** (Fix 6) — On index-based sync, cache was wiped and replaced with (potentially stale) index data. Now shows index as a fast preview via `cacheAllMeta`, then awaits `bootstrapDeltaToken` to discover additions/deletions, and reconciles with the merged set.

- **No concurrent sync guard** (Fix 7) — `loadArticles` could run concurrently, racing on delta token saves and cache mutations. Added a module-level `isSyncing` lock.

- **`openArticle` race condition** (Fix 8) — Rapidly clicking two articles could show stale content from the first download. Added an epoch counter with three checkpoint checks in `openArticle`.

- **Duplicate global event handlers on screen re-entry** (Fix 9) — `renderLibrary` stacked `keydown`, `click`, `online`/`offline` listeners on `document`/`window` every time it was called. Added `trackListener()` / `teardownScreenListeners()` lifecycle system.

- **Resume handler too aggressive** (Fix 12) — 2-minute throttle skipped critical token refreshes on iOS. Now tries a non-forced `acquireTokenSilent` first (cheap), only escalates to `forceRefresh` on failure, with a 30-second hard floor.

- **Full-resync fallback for stale tokens** (Fix 15) — If `lastSyncTime` is >1 hour old or absent, the delta token is cleared to force a full sync, catching stale tokens that silently serve outdated data.

- **Service worker could interrupt auth redirects** (Fix 19) — `registerType: 'autoUpdate'` with `skipWaiting` could activate a new service worker mid-auth redirect. Changed to `registerType: 'prompt'` with deferred activation until `handleRedirectPromise()` completes.

### Added

- **BroadcastChannel cross-tab sync** (Fix 10) — Uses `BroadcastChannel` (with `storage` event fallback for Safari <15.4) to propagate `sync-complete`, `article-mutated`, `settings-updated`, and `auth-changed` events between tabs. New `src/services/broadcast.ts` module.

- **ETag-guarded metadata writes** (Fix 11) — `uploadMeta` now sends `If-Match` with the article's ETag when available. On 412 conflict, re-downloads the server version, merges the change via a caller-supplied `mergeFn`, and retries.

- **Last synced timestamp** (Fix 13) — Stores `lastSyncTime` in IndexedDB after every successful sync. Displayed in sidebar footer (e.g., "synced 3m ago").

- **iOS divergence UX notice** (Fix 16) — Detects likely cache-vs-cloud mismatch (no delta token + stale `lastSyncTime`). Shows a concise notice bar with a one-tap "Refresh from Cloud" button instead of silently serving stale data.

- **Settings sync version counter** (Fix 17) — Added a monotonic `syncVersion` counter alongside `updatedAt` in the settings envelope. Used as the primary conflict resolution signal (falls back to timestamp comparison when version is absent), reducing clock-skew risk.

- **Production observability breadcrumbs** (Fix 18) — Structured `console.debug` breadcrumbs: `[Auth]` for token lifecycle, `[Sync]` for delta token source/bootstrap results, `[Cache]` for IDB transaction outcomes. All logs redact tokens and identifiers.

### Changed

- **Preferences moved to IndexedDB** (Fix 14) — Sort, filter, and sidebar-width preferences now use IndexedDB as primary storage with an in-memory cache for synchronous reads. One-time migration from localStorage. Theme stays in localStorage for FOUC prevention. `initPreferences()` is async and called during app boot.

- **SyncCoordinator architecture** (Fix 20) — Extracted all sync orchestration, write queueing, divergence detection, and cross-tab broadcast logic from `library.ts` into a dedicated `src/services/sync-coordinator.ts` module. The coordinator owns the sync lock, article state, stale-sync fallback, and a write queue with optimistic updates + exponential-backoff retry (3 attempts, 1→2→4s). On permanent write failure, mutations are rolled back locally and a `mutation-reverted` event notifies the UI. `library.ts` subscribes to coordinator events for rendering, reducing its sync responsibilities to pure UI mapping.

---

## [1.4.2] — 2026-02-14

### Fixed

- **Stale articles on iOS** — Safari's aggressive HTTP cache could serve stale Graph API responses, causing the delta sync to miss new or regenerated articles. All Graph API `fetch` calls now use `cache: 'no-store'` to force network requests, matching the existing Workbox `NetworkOnly` strategy at the service-worker level.

- **Regenerated articles served from stale cache** — When an article was regenerated on another device (new HTML content, same ID), the PWA continued to display the old cached HTML from IndexedDB. The HTML cache now stores the article's `size` at cache time. On subsequent opens, if the metadata `size` has changed (indicating regenerated content), the stale HTML is discarded and re-downloaded. The delta sync also proactively invalidates cached HTML and images for articles whose `size` changed.

---

## [1.4.1] — 2026-02-14

### Fixed

- **WCO action buttons behind window controls** — The article header action buttons (favorite, share, original, delete) used absolute positioning that placed them at the top-right of the header, overlapping the OS window controls in Window Controls Overlay mode. Added `position: static` in the WCO media query so the buttons participate in the grid layout and render below the titlebar area as intended.

### Changed

- **Dominant-color image placeholders** — While article images load from IndexedDB or OneDrive, each `<img>` now shows a shimmer animation tinted with the image's dominant color. The dominant color is extracted via a 1×1 `OffscreenCanvas` on first download and cached alongside the blob for instant retrieval on subsequent opens. Images with known `width`/`height` from metadata also get an `aspect-ratio` set immediately to prevent layout shift.

---

## [1.4.0] — 2026-02-14

### Added

- **Lightweight article index** — The PWA now maintains a single `_index.json` file on OneDrive containing all article metadata. On first sync (or after iOS storage eviction), the app downloads this one file instead of fetching each article's metadata individually — reducing initial sync from ~N HTTP requests to 1. The index is rebuilt automatically after any sync that detects changes (new articles, deletions, favorites). A background `bootstrapDeltaToken` step pages through the Graph delta API to acquire a delta token for subsequent incremental syncs and catches any articles added by the extension since the index was last built.

- **Image caching in IndexedDB** — Article images downloaded from OneDrive are now cached locally in a new `images` IndexedDB store (DB version bumped to 3). On subsequent article opens, images resolve from the local cache instead of re-downloading from OneDrive. Cached images are cleaned up when articles are deleted or the cache is cleared.

### Changed

- **Parallel metadata downloads** — Both `syncArticles()` and `listArticles()` now download article metadata in parallel batches (concurrency limit of 6) instead of sequentially. For the delta and list-fallback paths, this reduces sync time by roughly 5-6x.
- **Deferred image resolution** — Article images are now resolved lazily after the iframe renders instead of blocking on image download/cache lookup before setting `srcdoc`. Cached articles appear instantly with text visible first; images pop in moments later from IndexedDB or OneDrive.
- **`npm run update`** — Added a convenience script that runs `npm update` with `.env` loaded via `dotenv-cli` (needed for `GITHUB_NPM_TOKEN` to resolve the private registry).

### Fixed

- **iOS signs out constantly** — iOS aggressively kills PWA WKWebView processes when backgrounded, and can evict localStorage under storage pressure — wiping MSAL's token cache and making the app appear signed out. Added a three-layer fix: (1) MSAL cache mirror in IndexedDB (`msal-cache-backup.ts`), which is more durable than localStorage on iOS, restored automatically on cold start; (2) silent auth recovery via refresh token and `ssoSilent` before falling back to the sign-in screen; (3) proactive `visibilitychange` handler that refreshes the access token when the app resumes from background, preventing stale-token errors on the first Graph call.
- **Flash of empty reader on mobile** — When opening an article on mobile, the reading pane is now shown immediately with the loading spinner before content starts downloading. Content is revealed only after the iframe has fully parsed and rendered, preventing a flash of blank content. Also improved iframe readiness detection to check `childElementCount` and gracefully handle the max-retry case.

---

## [1.3.0] — 2026-02-12

### Added

- **Reuse existing window on share** — Added `launch_handler` with `client_mode: "navigate-existing"` to the manifest so share-target activations reuse an open PWA window instead of spawning a new one.

### Fixed

- **WCO article header wastes vertical space** — In Window Controls Overlay mode the article header reserved the full titlebar height as dead space above the title. Switched to a CSS grid layout: the title and metadata span both rows and vertically center across the full visible titlebar, while the action buttons sit in a second row aligned with the window controls. The second column's min-width matches the window-controls width so the title text never extends behind the OS chrome.

- **Stale articles persisting after deletion** — When the delta token expired (HTTP 410) or on first sync, the PWA fell back to a full article list but merged it into the existing cache without removing entries that no longer exist on OneDrive. Added `reconcileCache()` which replaces metadata and prunes orphaned HTML, ensuring the cache exactly mirrors the server after a full re-sync.
- **Missing recent articles after transient download failure** — If downloading an individual article's metadata failed during delta sync, the article was silently skipped but the delta token still advanced past it. The article would never appear unless the delta token was manually reset. Now tracks download failures and withholds the delta token so the next sync retries the failed items.
- **Incomplete deletion detection in delta sync** — Added check for the Graph API `@removed` annotation in addition to the `deleted` facet, ensuring remotely deleted articles are properly detected in all delta response formats.
- **Blank generated images in articles** — Articles from the Illustrated recipe showed blank boxes where AI-generated images should appear. The article CSS uses `opacity: 0` on the `.io` class with a JavaScript IntersectionObserver to fade images in on scroll — but scripts are blocked by the iframe sandbox. Injected CSS override (`.io, .reveal, .cap { opacity: 1 !important; transform: none !important; }`) into both the library reader and shared viewer iframes to force JS-animated elements to their visible state.
- **Background tiling in article reader** — Articles with `background-attachment: fixed` (e.g., subtle gradient washes) had their fixed background break inside the iframe because the article's `html, body { height: 100% }` reset constrained body to the iframe viewport height. Override `height: auto !important` on both elements so body grows to fit content and the fixed background painting area always covers the viewport.
- **Settings sync broken between extension and PWA** — `getUserId()` now fetches the Graph `/me` `id` (cached after first call) instead of using MSAL's `localAccountId`. The extension derives the cloud encryption key (HKDF) from the Graph user ID, so the PWA must use the same source to produce the same key. Added debug logging of userId prefix during encrypt/decrypt to match the extension's logging.
- **Broken images in transmogrified articles** — Article HTML with relative image/link paths (e.g., `/_next/static/media/...` from Next.js source sites) now resolves correctly. Injects a `<base>` tag pointing to the original article's URL so relative URLs load from the source site, not the PWA's origin. Applies to both the library reader and the shared article viewer.

## [1.2.0] — 2026-02-10

### Added

- **Custom 404 page** — Themed "page not found" screen with hero background, dark mode support, and a link back to the library
- **Auto-import settings on new device** — When signing in on a device with no local settings, the PWA automatically pulls existing settings from OneDrive. Existing settings are never overwritten.

### Fixed

- **Shared article links returning 404** — `staticwebapp.config.json` was at the repo root but the SWA deploy's `app_location` is `/dist`, so no routing rules (routes, navigation fallback, response overrides) were deployed. Moved the config into `public/` so Vite copies it to `dist/` at build time.
- **Gift token settings not appearing** — After redeeming a gift token, imported settings were not displayed in the form (fields appeared blank with a misleading "reload to apply" message). Now re-renders the full settings screen so values appear immediately.
- **WCO titlebar color mismatch** — Window Controls Overlay background (`theme-color`) now uses `--edge-surface-raised` values (`#FFFFFF`/`#2B2B30`/`#FBF6EB`) instead of `--edge-surface`, matching the sidebar, article, and settings headers exactly

### Added

- **WCO reader titlebar** — Added a surface-colored titlebar strip across the reader pane in Window Controls Overlay mode when no article is selected (or while an article is generating), preventing a color mismatch between the sidebar header and the empty reading area.
- **Gift token redemption** — Settings screen has a "Gift Token" section where users can enter a passphrase from a friend to import preconfigured AI/cloud/sharing settings.

---

## [1.1.0] — 2026-02-10

### Added

- **Shared badge in article list** — Articles with a share link now show a 🔗 chain icon in the reading list, next to the cloud badge (if present)

### Changed

- **Settings header matches theme** — Settings header now uses the surface/text design tokens (like the library sidebar) instead of a blue-teal gradient, so it blends with the WCO titlebar color
- **Simplified sync passphrase UI** — Removed the redundant "Confirm Passphrase" field; passphrase is now a single input
- **Sign-in WCO titlebar** — Added a surface-colored titlebar strip to the sign-in screen (visible only in Window Controls Overlay mode) so the window controls don't float over the hero image

### Fixed

- **iOS sign-out on every app switch** — iOS kills the PWA's WKWebView process aggressively when backgrounded. On cold restart, MSAL's `handleRedirectPromise()` could encounter stale interaction state and clear its in-memory account cache, making `isSignedIn()` return false even with valid tokens in localStorage. Added an account hint marker and MSAL instance recovery: when `handleRedirectPromise` fails but a previous session existed, stale interaction keys are cleaned and MSAL is re-initialised from a clean slate so it loads cached accounts correctly.
- **iOS passphrase lost on every app switch** — The sync passphrase was stored only in a module-level variable and explicitly cleared on `beforeunload`, which iOS fires on every process kill. Now the passphrase is encrypted with the per-device AES-256-GCM key and persisted in IndexedDB. On cold start, `restorePassphrase()` decrypts and loads it back into memory automatically. Removed the `beforeunload` wipe and 30-minute idle timeout — the passphrase persists until explicit sign-out or "Clear All Settings".

- **Sync button moved to footer** — Relocated the sync/refresh button from the sidebar header to the sidebar footer (bottom-right, next to library stats) for a cleaner toolbar
- **Shared viewer chrome bar** — Removed "Open App" CTA button; replaced it with a 🌐 globe button that links to the original article URL
- **Share metadata stored at share time** — Description, original URL, and hero image are now extracted from the article HTML when sharing and sent to the cloud API with the short link registration. The SSR function and shared viewer consume this pre-computed metadata instead of re-fetching and parsing the article HTML on every view.
- **Theme color matches app surface** — Browser title bar now uses the page surface color (`#FAFAFA` light, `#1B1B1F` dark, `#F4ECD8` sepia) instead of blue accent, for a cohesive look
- **Favorite star visibility** — Changed from empty/filled star glyphs (`☆`/`★`) to always-filled star with opacity styling. More legible in dark mode.
- **Sync button border** — Added border to the sync/refresh button in the sidebar header, matching the style of action buttons in the reader pane

### Fixed

- **Password manager autofill on passphrase field** — Added `name` and `autocomplete="current-password"` attributes to the sync passphrase inputs so 1Password and other password managers recognize the fields
- **Missing globe button & meta previews on shared pages** — Cloud API (`POST /api/share`) was not persisting `description`, `originalUrl`, and `image` fields, and `GET /api/s/{code}` was not returning them. Fixed in transmogrify-ext cloud functions. Existing shares will still lack these fields until re-shared.

### Added

- **Social media preview tags** — Shared article pages inject OpenGraph and Twitter Card meta tags (title, description, image) so share links get rich previews when posted on social media. Two layers: server-side (Azure Function) for crawlers, client-side (`setDocumentMeta`) as fallback.
- **Server-side OG meta tags** (`api/shared-meta/`) — Azure Function that pre-renders OpenGraph meta tags for `/shared/{code}` URLs. Makes a single outbound call to the cloud API (which now returns all preview metadata), renders an inline HTML template with OG tags, and boots the SPA normally. No article HTML download or index.html self-fetch needed.

---

## [1.0.0] — 2026-02-10

### Changed

- **Share dialog** — Replaced the `prompt()`-based share interaction with a proper modal dialog matching the Add URL modal's visual style. New share: shows an expiration picker (Never / 7 / 30 / 90 days, default 30), stays open during upload with a "Sharing…" spinner, then transforms to show the generated URL with a "Copy URL" button. Already shared: shows the current link in an inline-copyable field along with Unshare and "Copy URL" buttons.
- **Original article icon** — Changed the "Open original article" button icon from 🔗 to 🌐 to distinguish it from the share link icon

### Added

- **Article sharing** — Share button in the article header lets you create a public link (`transmogrifia.app/shared/{code}`) that anyone can view without signing in. Uses BYOS (Bring Your Own Storage) with Azure Blob Storage configured in the extension’s Settings. Creates a 30-day link, copies to clipboard, and syncs share status to OneDrive. Click again to copy the existing link or unshare.
- **Shared article viewer** — New `/shared/{code}` route bypasses the auth gate and renders shared articles in a branded viewer shell. Resolves short codes via the cloud API, fetches HTML from the user’s blob storage, and displays in a sandboxed iframe. Includes error state for expired/removed links.
- **Blob storage service** (`blob-storage.ts`) — Handles blob upload/delete and short link registration for sharing from the PWA
- **Window Controls Overlay** — Added `display_override: ["window-controls-overlay"]` to the PWA manifest so the installed app suppresses the default titlebar on Windows. Sidebar header, article header, and settings header act as draggable title bar regions with interactive controls excluded. Titlebar-area env vars keep content clear of the window controls.

### Fixed

- **iOS safe-area insets on all views** — Applied `env(safe-area-inset-*)` padding to settings header/content, library sidebar header/footer, sign-in screen, and mobile reading pane so UI controls clear the home indicator on notched/Dynamic Island iPhones
- **Mousewheel scroll blocked on some articles** — Articles from sites with `overflow: hidden` on wrapper elements would trap mousewheel events. Root cause: per CSS spec, setting `overflow-x: hidden` on body forces `overflow-y` from `visible` to `auto`; if body has no real overflow (`scrollH == clientH`), it absorbs wheel events without scrolling and never propagates them to `<html>` (the actual scroll container). Fix: injected CSS now puts `overflow-x: hidden` only on `<html>` and forces `body { overflow: visible !important }` to prevent it from becoming a scroll trap. `fixScrollBlocking` DOM walk also checks for real overflow (`scrollH > clientH`) and uses `visible` instead of `auto` on wrapper divs that have no scrollable content

---

## [0.11.0] — 2026-02-09

### Added

- **Settings screen** — New `#settings` route with card-based UI for configuring AI provider (Azure OpenAI, OpenAI, Anthropic, Google), image provider, and sync passphrase; accessible via user dropdown menu
- **Encrypted settings storage** — API keys encrypted at rest using a per-device AES-256-GCM CryptoKey stored in IndexedDB; zero-friction local access with no passphrase needed
- **Settings sync via OneDrive** — Push/pull encrypted settings to/from OneDrive (`settings.enc.json`) using a user-chosen passphrase (PBKDF2 600k iterations + AES-256-GCM); compatible with the Transmogrifier extension's sync format
- **Add URL feature** — "+ Add" button in library toolbar opens a modal to submit a URL for cloud transmogrification; auto-syncs to pick up the result
- **In-progress job tracking** — Cloud jobs appear as pending items at the top of the article list with a spinner, recipe, and elapsed time; clicking shows a progress card in the reading pane with a cancel button; smart polling (15s → 30s → 60s → every 30s) detects completion and auto-opens the new article
- **Generate images toggle** — "Generate images" checkbox in the Add URL modal; sends image provider config to the cloud API when enabled
- **Share Target support** — PWA registers as a Web Share Target (`share_target` in manifest); on Android, ChromeOS, Windows, and macOS, sharing a URL from any app opens the Add URL modal pre-filled
- **iOS Share Shortcut guide** — iOS Settings section with step-by-step instructions for creating an Apple Shortcut that sends shared URLs to the PWA via the share sheet; includes a copy-able URL template
- **Cloud queue service** — New `cloud-queue.ts` service sends URL + user AI keys to the cloud API for server-side transmogrification
- **Crypto service** — `crypto.ts` and `device-key.ts` ported from the extension (pure Web Crypto + IndexedDB, no Chrome dependencies)
- **Hash-based routing** — `main.ts` now routes between `#library` (default) and `#settings` via `hashchange` listener
- **Idle timeout for passphrase** — Sync passphrase cleared from memory after 30 minutes of inactivity and on page unload

### Changed

- **IndexedDB version bump** — `TransmogrifiaPWA` database version 1 → 2; added `settings` object store for encrypted settings envelope
- **Types expanded** — Added `AIProvider`, `ImageProvider`, `AIProviderSettings`, `ImageProviderSettings`, `CloudSettings`, `TransmogrifierSettings`, `UserAIConfig`, and `UserImageConfig` types to `types.ts`
- **Graph service** — Added `downloadSettings()` and `uploadSettings()` functions for OneDrive settings sync; uses `CloudSettingsFile` wrapper format (`{ envelope, updatedAt }`) compatible with the extension

---

## [0.10.13] — 2026-02-09

### Changed

- **FAB pill iOS safe-area clearance** — Added `env(safe-area-inset-bottom)` offset so the floating action buttons sit above the home indicator on notched/Dynamic Island iPhones
- **Larger FAB touch targets** — Increased button size from 38×38px to 44×44px (Apple HIG minimum), bumped font size, border-radius, and separator height to match

---

## [0.10.12] — 2026-02-09

### Fixed

- **Sign-in flow broken on desktop and mobile** — Popup-based sign-in was failing because MSAL v5's popup monitoring couldn't reliably read the auth response from the popup window (Vite dev server and script loading interfered with the URL hash). Replaced all popup-based auth flows (`loginPopup`, `logoutPopup`, `acquireTokenPopup`) with redirect-based equivalents (`loginRedirect`, `logoutRedirect`, `acquireTokenRedirect`) which are more reliable across all browsers and platforms. Added stale MSAL interaction state cleanup on `handleRedirectPromise` failure to prevent `no_token_request_cache_error` from blocking subsequent sign-in attempts. The `handleRedirectPromise()` return value is now checked in `main.ts` to detect redirect-based sign-in completion and route straight to the library.
- **iOS standalone PWA sign-in delay** — On iOS, `loginRedirect` opens an in-app Safari sheet instead of navigating the page. When the sheet closes, the PWA resumes without reloading, so `handleRedirectPromise()` never fires on the return. Added a `visibilitychange` listener on the sign-in screen that re-processes the redirect response and checks for a cached account when the app regains focus, transitioning to the library immediately.

---

## [0.10.11] — 2026-02-08

### Added

- **Reader floating action buttons** — Added a pill-shaped FAB row at the bottom-right of the reader viewport with Back, Previous (↑), and Next (↓) buttons for quick article navigation; prev/next buttons disable at list boundaries

### Removed

- **iOS Safari workarounds** — Reverted redirect auth flow, iframe document replacement monitoring, and generation-counter iframe readiness strategy introduced in 0.10.10; the workarounds caused unintended back-navigation to the sign-in flow. Retained the iOS auto-zoom fix (16px input font-size via `@supports`)

---

## [0.10.8] — 2026-02-08

### Fixed

- **iOS Safari gesture support** — Added `touch-action: pan-y pinch-zoom` to reading pane, content frame, and injected iframe styles so WebKit doesn't pre-empt horizontal swipes; injected `overscroll-behavior: none` into iframe content to suppress rubber-band bounce at scroll boundaries; switched iframe event target from `Document` to `documentElement` for reliable touch dispatch on WebKit; replaced `setTimeout(0)` with `requestAnimationFrame` retry loop for robust `contentDocument` access after `srcdoc` load
- **Back swipe after resize** — Back-swipe gesture now works immediately when resizing from a wide viewport to narrow, without requiring a page refresh; viewport-width check moved from init time to swipe time

---

## [0.10.7] — 2026-02-08

### Changed

- **Dependency upgrades** — Updated `@azure/msal-browser` 3.30→5.1, `vite` 6.4→7.3, `vite-plugin-pwa` 0.21→1.2; removed deprecated `storeAuthStateInCookie` cache option (IE11 legacy)

---

## [0.10.6] — 2026-02-08

### Changed

- **Overscroll prev/next on all viewports** — Swipe-to-navigate between articles now works on wide (two-pane) viewports, not just narrow/mobile screens; back swipe remains mobile-only

---

## [0.10.5] — 2026-02-08

### Fixed

- **Overscroll nav scroll detection** — Fixed `getScrollInfo` to explicitly check both `documentElement` and `body` for scroll overflow instead of relying on `scrollingElement`, which doesn't work reliably in sandboxed srcdoc iframes; also lock scroll state at `touchstart` and decide gesture direction once so native scroll doesn't invalidate the check mid-gesture

---

## [0.10.4] — 2026-02-08

### Fixed

- **Overscroll nav triggers too easily** — Removed overscroll prev/next listeners from the reading pane (header bar); overscroll navigation now only triggers from within the article iframe when actually scrolled to the top or bottom. Also fixed the fallback scroll check to default to "not at edge" when the iframe document is inaccessible

---

## [0.10.3] — 2026-02-08

### Fixed

- **Gesture listeners on iframe body** — Fixed touch gestures (swipe-back, overscroll nav) not working on article content on mobile; `onload` handler is now set before `srcdoc` and gesture attachment is deferred by a tick to ensure the iframe's `contentDocument` is fully settled before listeners are attached

---

## [0.10.2] — 2026-02-08

### Added

- **README.md** — Added project README with feature overview, setup instructions, tech stack, project structure, and link to companion Transmogrifier extension

---

## [0.10.1] — 2026-02-08

### Fixed

- **Empty access token guard** — `getAccessToken()` now validates that `acquireTokenSilent` and `acquireTokenPopup` return a non-empty access token; throws `InteractionRequiredAuthError` to trigger re-auth if the token is empty
- **Delta sync optimization** — `syncArticles()` now uses `@microsoft.graph.downloadUrl` from delta response items when available, avoiding an extra Graph API call per metadata file (matching extension fix)

---

## [0.10.0] — 2026-02-08

### Added

- **Delta sync** — Uses Microsoft Graph delta API for incremental article syncing across devices, replacing full-list fetches
- **Instant cache-first loading** — Cached articles display immediately on launch while syncing happens in the background
- **Sync button** — Manual refresh button (⟳) in the sidebar header to trigger a sync on demand
- **Delete article** — Trash button in the reader header bar to delete articles from OneDrive with confirmation prompt
- **Merge-based caching** — Delta results are merged into the local cache instead of replacing it, preventing articles from disappearing during stale listings

---

## [0.9.7] — 2026-02-07

### Fixed

- **Gesture navigation on article body** — Touch gestures now attach to the iframe's contentDocument so swipe-back and overscroll navigation work anywhere on the article, not just the title bar
- **Article horizontal scroll** — Injected CSS into article iframe to lock `overflow-x`, constrain wide images/tables/code blocks to viewport width

---

## [0.9.6] — 2026-02-07

### Added

- **Swipe-back gesture** — Swipe right from the left edge on mobile to return to the article list, with animated indicator
- **Overscroll article navigation** — Pull down at the top or up at the bottom of an article to navigate to the previous/next article

### Fixed

- **Mobile horizontal scroll** — Added `overscroll-behavior: none` and `visibility: hidden` on off-screen reading pane to prevent iOS Safari rubber-band scrolling

---

## [0.9.5] — 2026-02-07

### Fixed

- **Iframe sandbox warning** — Removed `allow-scripts` from article iframe sandbox; articles render fine without JS and this eliminates the "escape sandboxing" console warning
- **Google Fonts blocked in articles** — Added `fonts.googleapis.com` to CSP `style-src` and `fonts.gstatic.com` to `font-src` so article stylesheets can load web fonts

---

## [0.9.4] — 2026-02-07

### Fixed

- **CSP connect-src wildcard mismatch** — CSP `*.1drv.com` only matches one subdomain level, but Graph API `/content` redirects to multi-level CDN domains like `public.dm.files.1drv.com`; broadened `connect-src` to `https:` since Microsoft CDN domains are unpredictable

---

## [0.9.3] — 2026-02-07

### Fixed

- **CSP blocking Graph API content downloads** — Added `https://*.1drv.com` and `https://*.sharepoint.com` to `connect-src`; Graph `/content` endpoints return 302 redirects to OneDrive CDN domains, which were being blocked
- **Deprecated meta tag** — Replaced `apple-mobile-web-app-capable` with `mobile-web-app-capable`
- **Unused hero preload warning** — Removed `<link rel="preload">` for hero image (only used on sign-in screen, not every page)

---

## [0.9.2] — 2026-02-07

### Fixed

- **X-Frame-Options blocking MSAL silent auth** — Changed `X-Frame-Options` from `DENY` to `SAMEORIGIN` so MSAL’s hidden iframe can redirect back to the app’s own origin during `acquireTokenSilent`, fixing article loading on the live site

---

## [0.9.1] — 2026-02-07

### Fixed

- **CSP blocking auth on live site** — Added `https://login.microsoftonline.com` and `https://login.live.com` to `frame-src` and `connect-src` in `staticwebapp.config.json`, fixing silent token acquisition (and therefore article loading) on the deployed site

---

## [0.9.0] — 2026-02-07

### Added

- **AI-generated hero image** — Watercolor Library of Alexandria illustration as sign-in background (AVIF/WebP/JPEG with responsive variants)
- **AI-generated app icon** — Classical watercolor scroll/book icon replacing emoji placeholder
- **Image processing pipeline** — Sharp-based scripts for generating optimized icons and hero images (`npm run img:generate`, `npm run img:process`)
- **Proper raster icons** — Full icon set (16–512px PNGs, Apple Touch Icon, maskable icon) replacing SVG placeholders
- **`.env.example`** — Template for Azure OpenAI image generation credentials
- **Copilot instructions** — Added `.github/workflows/copilot-instructions.md` with project conventions, design system reference, and Azure OpenAI API patterns
- **Dev dependencies** — Added `sharp` and `@types/node` for image processing; added `tsx` script aliases in `package.json`

### Changed

- **App icon padding** — Cropped ~75% of whitespace from the icon source image for a tighter, more prominent icon at all sizes
- **Sign-in screen redesign** — Full-bleed hero background with frosted-glass card overlay, responsive across themes and mobile
- **Library brand icon** — Replaced emoji `📦` with generated watercolor `<img>` icon in sidebar header
- **Web app manifest** — Added `orientation`, `categories`, maskable icon, proper icon size ladder, AVIF/WebP background color
- **Favicon** — Embedded PNG-in-SVG favicon + 32px PNG fallback replacing plain emoji SVG
- **index.html** — Added Apple mobile web app meta tags, preload for hero image, favicon-32 fallback link
- **Auth resilience** — Enabled `storeAuthStateInCookie` for Safari/iOS; added redirect fallback when `acquireTokenPopup` is blocked
- **Graph API type safety** — Explicit types on `fetch` responses and `data.value` iteration to eliminate implicit `any`
- **.gitignore** — Exclude raw AI-generated images (`public/images/*-raw.png`) from version control

---

## [0.8.0] — 2026-02-07

Initial release of the Library of Transmogrifia PWA.

### Features

- **Authentication** — Sign in with Microsoft account via MSAL.js (PKCE, popup with redirect fallback)
- **Article library** — Browse all transmogrified articles from OneDrive with search, filter by recipe/favorites/downloaded, and sort (newest/oldest/A-Z)
- **Article reader** — Sandboxed iframe rendering of self-contained article HTML
- **Favorite toggle** — Optimistic update with OneDrive sync; reverts on failure
- **Offline support** — Service worker precaches app shell; article HTML cached in IndexedDB on first open
- **Responsive layout** — Two-pane (desktop/tablet) and single-pane with slide transition (mobile)
- **Keyboard shortcuts** — `j`/`k` navigate, `f` favorite, `/` search, `Escape` back
- **Themes** — Light, dark, sepia, and system-auto via CSS custom properties
- **User menu** — Sign out, clear cache
- **Resizable sidebar** — Drag handle with persisted width
- **Skeleton loading** — Pulsing placeholder while metadata loads
- **Offline banner** — Automatic detection with cached article fallback
- **Cache stats** — Footer shows article count and cache size
- **PWA install** — Web app manifest, service worker, installable on all platforms
- **Azure Static Web Apps deployment** — Auto-deploy on push to main

### Fixed

- Remove unsupported `$filter=endswith()` from consumer OneDrive Graph API call; filter `.json` files client-side instead
- Surface `initLibrary()` errors via toast instead of swallowing silently
