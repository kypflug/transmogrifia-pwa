# Library of Transmogrifia — Copilot Quick Reference

> Spec & implementation plan: see `pwa-spec/` in the companion repo [transmogrify-ext](https://github.com/kypflug/transmogrify-ext)

## What This Is
Standalone PWA (Progressive Web App) for reading Transmogrifier articles on any device. Users sign in with their Microsoft account, and the app loads their saved transmogrifications from OneDrive. Read-only — no article generation.

## Tech Stack
TypeScript (strict) | Vite | Vanilla TS | MSAL.js 2.x (`@azure/msal-browser`) | Microsoft Graph API | IndexedDB | vite-plugin-pwa (Workbox)

## Structure
```
src/
  main.ts              # Entry point: auth check → route to sign-in or library
  recipes.ts           # Minimal recipe metadata (id, name, icon) for display
  types.ts             # Shared types (OneDriveArticleMeta, etc.)
  services/
    auth.ts            # MSAL wrapper (sign-in, sign-out, token acquisition)
    graph.ts           # Microsoft Graph API calls (list, download, upload meta)
    cache.ts           # IndexedDB article cache (metadata + HTML)
    preferences.ts     # localStorage prefs (sort, filter, theme, sidebar width)
  screens/
    sign-in.ts         # Sign-in screen controller
    library.ts         # Two-pane library: article list + reader
  components/
    article-list.ts    # Render/filter/sort article list items
    article-header.ts  # Reader header bar (title, actions)
    toast.ts           # Toast notification component
  styles/
    global.css         # Reset, design tokens, typography, dark/sepia themes
    sign-in.css        # Sign-in screen
    library.css        # Library layout (adapted from extension)
    reader.css         # Reader pane
```

## Key Patterns
- **Auth:** MSAL.js PKCE flow → `loginPopup()` → tokens cached in localStorage → `acquireTokenSilent()` for Graph calls
- **Data flow:** List `.json` metadata from OneDrive AppFolder → cache in IndexedDB → lazy-download HTML on article open
- **Same Azure AD app** as the Transmogrifier extension (client ID `4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2`), sharing the same `Files.ReadWrite.AppFolder` scope and `articles/` folder
- **Offline-first:** Article HTML cached in IndexedDB after first download; app shell precached by service worker
- **Favorite toggle** is the only write operation — optimistic local update, then PUT updated `.json` to OneDrive
- **Article rendering:** Sandboxed iframe with `srcdoc`, same as the extension
- **Responsive:** Two-pane (≥768px) or single-pane with slide transition (<768px)
- **No `chrome.*` APIs** — this is a standard web app, not an extension

## OneDrive Storage Layout
```
/drive/special/approot/articles/
  ├── {id}.json   ← OneDriveArticleMeta (title, url, recipe, dates, favorite, size)
  └── {id}.html   ← Complete self-contained HTML document
```

## Graph API Endpoints Used
| Operation | Method | Endpoint |
|-----------|--------|----------|
| List metadata files | GET | `/me/drive/special/approot:/articles:/children?$filter=endswith(name,'.json')` |
| Download metadata | GET | `/me/drive/special/approot:/articles/{id}.json:/content` |
| Download HTML | GET | `/me/drive/special/approot:/articles/{id}.html:/content` |
| Update metadata | PUT | `/me/drive/special/approot:/articles/{id}.json:/content` |
| User profile | GET | `/me` |

## Design System
Fluent/Edge design tokens inherited from the extension, defined as CSS custom properties in `:root` and overridden per theme.

### Colors
```
--edge-blue: #0078D4          (primary accent, links, spinner, active states)
--edge-blue-hover: #106EBE    (button/link hover)
--edge-blue-light: #DEECF9    (light: selected bg)  → #1a3a5c (dark)
--edge-blue-muted: #EBF3FC    (light: subtle highlight) → #152d47 (dark)
--edge-teal: #00A8A8           (secondary accent)
--edge-teal-dark: #038387
--edge-green: #107C10          (success)
--edge-red: #D13438            (error, offline banner)
--edge-red-light: #FDE7E9     (light: error bg) → #4a1a1c (dark)
```

### Surfaces & Text
| Token | Light | Dark | Sepia |
|-------|-------|------|-------|
| `--edge-surface` | `#FAFAFA` | `#1B1B1F` | `#F4ECD8` |
| `--edge-surface-raised` | `#FFFFFF` | `#2B2B30` | `#FBF6EB` |
| `--edge-surface-sunken` | `#F3F3F3` | `#111114` | `#EDE4CE` |
| `--edge-border` | `#E1E1E1` | `#3A3A3F` | `#D4C9A8` |
| `--edge-border-subtle` | `#EBEBEB` | `#2E2E33` | `#E0D7C0` |
| `--edge-text-primary` | `#1B1B1F` | `#E5E5E5` | `#3E3424` |
| `--edge-text-secondary` | `#616161` | `#A0A0A0` | `#7A6E5A` |
| `--edge-text-tertiary` | `#9E9E9E` | `#6A6A6A` | `#A09480` |

### Typography
- **Font stack:** `'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif`
- **Base size:** 14px
- **Line height:** 1.5

### Elevation & Shape
- `--edge-shadow-sm`: subtle card shadow (light: `rgba(0,0,0,0.06)`+`0.1`, dark: `0.2`+`0.3`)
- `--edge-shadow-md`: raised elements, toasts, dropdowns
- `--edge-radius`: 6px (standard controls, cards)
- `--edge-radius-lg`: 10px (large containers)

### Themes
Three themes: light (default), dark, sepia. Applied via `data-theme` attribute on `<html>`:
- Light: clean whites and grays, blue accent
- Dark: deep charcoal surfaces, same blue accent
- Sepia: warm parchment tones for reading comfort

## Code Style
- TypeScript strict mode, no `any`
- Functional patterns preferred; module-level state (no framework)
- Semantic HTML in UI
- CSS custom properties for theming, no preprocessor
- `npm run dev` = `vite` (dev server on :5173)
- `npm run build` = `tsc && vite build` → static output in `dist/`

## House Style — Markup & CSS

### HTML Generation
- **Template literals via `innerHTML`** — screens and components set markup by assigning template literal strings to `container.innerHTML`. No framework, virtual DOM, or web components.
- **Component pattern:** Plain exported functions that take an `HTMLElement` container (and data) and mutate its `innerHTML`:
  ```ts
  export function renderXxx(container: HTMLElement, ...data): void {
    container.innerHTML = `...`;
  }
  ```
- **Event listeners** are attached imperatively after rendering, using `document.getElementById()` or `container.querySelector()`.
- **Toast is the exception** — uses `document.createElement()` + `document.body.appendChild()` since toasts live outside the app container.

### Semantic HTML
- Use semantic elements where appropriate: `<aside>` for sidebar, `<main>` for reading pane, `<button>` for all interactive controls, `<h1>`–`<h2>` for headings
- General structural containers are `<div>` with descriptive class names
- Single root mount point: `<div id="app">` — screens render into this container
- Article content displayed in `<iframe sandbox srcdoc="...">` with `title="Article content"`

### CSS Class Naming
Hyphen-separated, component-prefixed flat naming (BEM-inspired but not strict BEM):
- **Layout:** `library-layout`, `sidebar`, `reading-pane`, `resize-handle`
- **Components:** `article-item`, `article-item-top`, `article-header`, `article-header-title`, `article-header-actions`
- **Functional:** `search-box`, `search-input`, `search-icon`, `filter-row`, `filter-select`, `sort-select`
- **State classes:** `hidden`, `active`, `visible`, `is-offline`, `mobile-reading`
- **Screen-scoped:** `sign-in-screen`, `sign-in-card`, `sign-in-brand`, `sign-in-btn`
- **Skeleton loading:** `skeleton-list`, `skeleton-item`, `skeleton-line long`, `skeleton-line short`

Pattern: `[component]-[element]` with `-` separators. State modifiers are separate utility classes.

### CSS Conventions
- **Vanilla CSS only** — no preprocessors (Sass, Less, etc.)
- **CSS custom properties** (design tokens) defined in `:root` with `--edge-` prefix, overridden via `[data-theme="dark"]` and `[data-theme="sepia"]` attribute selectors
- **No `!important`** — specificity managed through class naming
- **Mobile-first** not required, but responsive breakpoint at `768px` (two-pane ↔ single-pane)
- Visibility toggled via the `hidden` class, not inline `display: none`

### Accessibility
- `role="alert"` on toast notifications for screen reader announcements
- `role="button"` + `tabindex="0"` on clickable non-button elements (e.g., article list items), with both `click` and `keydown Enter` handlers
- `aria-label` on icon-only buttons (e.g., back button, favorite toggle)
- `title` attributes on buttons with non-obvious function
- `<iframe title="...">` for article content
- `<html lang="en">`
- Keyboard shortcuts: `j`/`k` navigation, `/` to focus search, `Escape` to close, `f` for favorite

### Icons & Imagery
- **Emoji as icons** for most UI elements: brand (`📦`), search (`🔍`), reader (`📖`), empty state (`📭`), etc.
- **Inline SVG** only where emoji won't do (e.g., Microsoft logo on sign-in)
- No icon font or SVG sprite sheet

### Security
- **`escapeHtml()`** utility used consistently to sanitize user-generated text before injecting into templates — never insert raw user input into `innerHTML`
- Article HTML rendered in sandboxed `<iframe>` to isolate untrusted content

## Documentation & Git Rules
- **README.md:** Keep up to date with any new features, setup steps, or config changes
- **CHANGELOG.md:** Add an entry for every meaningful change (new features, bug fixes, refactors). Use `## [Unreleased]` at the top and group entries under `### Added`, `### Changed`, `### Fixed`, `### Removed`
- **Never push to remote** (`git push`) unless the user explicitly asks you to. Stage and commit locally only.

## Azure OpenAI API Patterns

The `.env` file contains credentials for both chat completion and image generation. These are Azure OpenAI endpoints (not openai.com), so the URL format and auth header differ from the standard OpenAI SDK.

### Environment Variables
```
VITE_AZURE_OPENAI_ENDPOINT      # e.g. https://<resource>.cognitiveservices.azure.com/
VITE_AZURE_OPENAI_API_KEY       # API key for chat completions
VITE_AZURE_OPENAI_DEPLOYMENT    # e.g. gpt-5.2
VITE_AZURE_OPENAI_API_VERSION   # e.g. 2024-10-21

VITE_AZURE_IMAGE_ENDPOINT       # Same or different endpoint for images
VITE_AZURE_IMAGE_API_KEY        # API key for image generation
VITE_AZURE_IMAGE_DEPLOYMENT     # e.g. gpt-image-1.5
VITE_AZURE_IMAGE_API_VERSION    # e.g. 2024-10-21
```

### Chat Completion (text/JSON responses)
```typescript
const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'api-key': apiKey,                    // NOTE: 'api-key' header, NOT 'Authorization: Bearer'
  },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 16384,
    temperature: 0.7,
    response_format: { type: 'json_object' },  // Omit for plain text responses
  }),
});

const result = await response.json();
const content = result.choices?.[0]?.message?.content;   // string (JSON or text)
const finishReason = result.choices?.[0]?.finish_reason;  // 'stop' | 'length' | 'content_filter'
// Check finishReason === 'length' to detect truncation
```

### Image Generation
```typescript
const url = `${imageEndpoint}/openai/deployments/${imageDeployment}/images/generations?api-version=${imageApiVersion}`;

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'api-key': imageApiKey,
  },
  body: JSON.stringify({
    prompt: 'A watercolor painting of a library',
    n: 1,
    size: '1024x1024',   // '1024x1024' | '1024x1536' | '1536x1024'
  }),
});

// House-style image prompt — adapt as needed for the subject:
// "Transform this image into a watercolor illustration. The watercolor effect
//  should be pronounced with paint bleeding, color blending, and brushstroke
//  textures. Use predominantly green and blue hues, a bit muted. Maintain the
//  same general composition, subject matter, and any text or labels."

const result = await response.json();
const imageData = result.data?.[0];
// imageData.b64_json  — base64-encoded PNG
// imageData.url       — temporary URL (expires)
// imageData.revised_prompt — what the model actually used

// Convert to data URL for <img src>:
const dataUrl = `data:image/png;base64,${imageData.b64_json}`;
```

### Recommended Workflow for AI-Assisted Tasks
When you need the AI to do something (generate content, analyze data, etc.):

1. **Write a standalone script** (e.g. `scripts/do-thing.ts`) that calls the API with hardcoded inputs
2. **Run it** with `npx tsx scripts/do-thing.ts` to get the response
3. **Clean up the output** — parse, format, integrate into the codebase
4. **Delete the script** once the result is incorporated

This keeps AI calls explicit, debuggable, and separate from app logic.

### House-Style Image Prompt
When generating images for the project, use an appropriate variation of this base prompt:

> "Transform this image into a watercolor illustration. The watercolor effect should be pronounced with paint bleeding, color blending, and brushstroke textures. Use predominantly green and blue hues, a bit muted. Maintain the same general composition, subject matter, and any text or labels."

Adapt the subject matter and composition details as needed, but keep the watercolor style, green/blue palette, and muted tone consistent.

### Key Gotchas
- **Auth header is `api-key`**, not `Authorization: Bearer ...` — this is Azure-specific
- **URL includes the deployment name**, not the model name
- **`response_format: { type: 'json_object' }`** requires the system prompt to mention "JSON"
- **Rate limits:** Add 500ms delays between sequential image requests
- **Truncation:** Always check `finish_reason === 'length'` — the response was cut off
- **Content filter:** `finish_reason === 'content_filter'` means Azure blocked the output

## What This App Does NOT Do
- Generate or transmogrify articles (read-only)
- Respin articles with different recipes
- Delete articles from OneDrive
- Use any `chrome.*` extension APIs
