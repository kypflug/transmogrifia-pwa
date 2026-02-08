# Changelog

All notable changes to Library of Transmogrifia will be documented in this file.

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
