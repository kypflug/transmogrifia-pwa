# Changelog

All notable changes to Library of Transmogrifia will be documented in this file.

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
