# Library of Transmogrifia

A Progressive Web App for reading your [Transmogrifier](https://github.com/kypflug/transmogrify-ext) articles on any device. Sign in with your Microsoft account, and the app loads your saved transmogrifications from OneDrive — beautifully formatted, offline-capable, and ready to read anywhere.

## What is Transmogrifier?

[Transmogrifier](https://github.com/kypflug/transmogrify-ext) is an Edge extension that transforms web articles into AI-enhanced reading experiences using customizable "recipes" — Focus, Reader, Aesthetic, Illustrated, and more. Articles are saved as self-contained HTML files to your OneDrive.

**Library of Transmogrifia** is the companion reader. You can also add articles directly from the PWA using the **Add URL** feature (requires a cloud API endpoint and your own AI keys).

## Features

- **Cloud library** — Browse all your transmogrified articles synced from OneDrive
- **Offline reading** — Articles are cached locally after first open; read without a connection
- **Search, filter & sort** — Find articles by title, filter by recipe or favorites, sort by date or name
- **Themes** — Light, dark, and sepia modes with system-auto detection
- **Responsive layout** — Two-pane on desktop/tablet, single-pane with swipe gestures on mobile
- **Keyboard shortcuts** — `j`/`k` navigate, `f` favorite, `/` search, `Escape` back
- **Share articles** — Create public URLs for articles that anyone can view without signing in
- **Installable** — Add to your home screen on any platform via the browser's install prompt
- **Delta sync** — Incremental syncing via Microsoft Graph delta API for fast refreshes
- **Delete articles** — Remove articles from OneDrive directly from the reader
- **Settings** — Configure AI provider, image provider, and sync passphrase; encrypted at rest with a per-device key
- **Encrypted settings sync** — Sync settings across devices via OneDrive using a user-chosen passphrase (PBKDF2 + AES-256-GCM)
- **Add URL** — Submit a URL for cloud transmogrification without needing the browser extension
- **In-progress tracking** — Cloud jobs show as pending items with spinners; click to see progress and cancel
- **Share Target** — On Android/ChromeOS/Windows/macOS, share a URL from any app to open the Add URL modal pre-filled
- **iOS Share Shortcut** — Settings include a guided setup for an Apple Shortcut to share URLs on iOS

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Microsoft account with articles saved by the [Transmogrifier extension](https://github.com/kypflug/transmogrify-ext)
- Note: [Transmogrifier](https://github.com/kypflug/transmogrify-ext) requires you to bring your own API keys for article transformation and image generation. Azure OpenAI, OpenAI, Anthropic (Claude), and Google (Gemini) are supported.

### Install & Run

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.

### Build

```bash
npm run build
```

Static output is written to `dist/`, ready for deployment.

### Preview Production Build

```bash
npm run preview
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (strict) |
| Build | Vite |
| UI | Vanilla TS — no framework |
| Auth | MSAL.js 2.x (`@azure/msal-browser`) |
| Data | Microsoft Graph API → OneDrive AppFolder |
| Offline | IndexedDB article cache + Workbox service worker |
| PWA | vite-plugin-pwa |
| Hosting | Azure Static Web Apps |

## Project Structure

```
src/
  main.ts              # Entry point: auth → route to sign-in or library
  recipes.ts           # Recipe metadata (id, name, icon) for display
  types.ts             # Shared TypeScript types
  theme.ts             # Theme application logic
  gestures.ts          # Touch gesture handling (swipe-back, overscroll nav)
  services/
    auth.ts            # MSAL wrapper (sign-in, sign-out, token acquisition)
    graph.ts           # Microsoft Graph API calls (list, download, upload, delete, settings sync)
    cache.ts           # IndexedDB article cache (metadata + HTML + settings)
    blob-storage.ts    # BYOS blob upload + short link registration for sharing
    preferences.ts     # localStorage preferences (sort, filter, theme, sidebar width)
    settings.ts        # Encrypted settings management (device-key + passphrase sync)
    crypto.ts          # AES-256-GCM encryption (passphrase and device-key modes)
    device-key.ts      # Per-device non-extractable CryptoKey in IndexedDB
    cloud-queue.ts     # Cloud API queue for URL-based transmogrification
  screens/
    sign-in.ts         # Sign-in screen
    library.ts         # Two-pane library: article list + reader + Add URL modal
    settings.ts        # Settings UI (AI/image providers, cloud URL, sync passphrase)
    shared-viewer.ts   # Public shared article viewer (no auth required)
  components/
    article-list.ts    # Render/filter/sort article list items
    article-header.ts  # Reader header bar (title, actions)
    toast.ts           # Toast notification component
  styles/
    global.css         # Design tokens, typography, dark/sepia themes
    sign-in.css        # Sign-in screen styles
    library.css        # Library layout
    reader.css         # Reader pane styles
    settings.css       # Settings screen styles
```

## How It Works

1. **Sign in** with your Microsoft account (MSAL.js PKCE popup flow)
2. The app reads `.json` metadata files from your OneDrive AppFolder (`/articles/`)
3. Metadata is cached in IndexedDB; subsequent launches load instantly from cache while syncing in the background
4. Selecting an article lazy-downloads the `.html` file from OneDrive and caches it locally
5. Articles render in a sandboxed `<iframe>` for security
6. The favorite toggle and settings sync are the write-back operations
7. **Add URL** sends a URL + your AI keys to a cloud API for server-side transmogrification; the result is uploaded to your OneDrive and appears on next sync
7. A service worker precaches the app shell for full offline support

## Deployment

The app is configured for [Azure Static Web Apps](https://azure.microsoft.com/products/app-service/static). Security headers and SPA routing are defined in `staticwebapp.config.json`.

## License

[MIT](LICENSE)
