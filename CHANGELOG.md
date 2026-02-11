# Changelog

All notable changes to Library of Transmogrifia will be documented in this file.

---

## [1.2.0] — 2026-02-10

### Added

- **Custom 404 page** — Themed "page not found" screen with hero background, dark mode support, and a link back to the library
- **Auto-import settings on new device** — When signing in on a device with no local settings, the PWA automatically pulls existing settings from OneDrive. Existing settings are never overwritten.

### Fixed

- **Shared article links returning 404** — `staticwebapp.config.json` was at the repo root but the SWA deploy's `app_location` is `/dist`, so no routing rules (routes, navigation fallback, response overrides) were deployed. Moved the config into `public/` so Vite copies it to `dist/` at build time.
- **Gift token settings not appearing** — After redeeming a gift token, imported settings were not displayed in the form (fields appeared blank with a misleading "reload to apply" message). Now re-renders the full settings screen so values appear immediately.
- **WCO titlebar color mismatch** — Window Controls Overlay background (`theme-color`) now uses `--edge-surface-raised` values (`#FFFFFF`/`#2B2B30`/`#FBF6EB`) instead of `--edge-surface`, matching the sidebar, article, and settings headers exactly

### Added

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
