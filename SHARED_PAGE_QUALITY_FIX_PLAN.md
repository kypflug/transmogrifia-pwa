# Shared Page Quality Fix Plan

Date: 2026-02-17 (consolidated)

## Scope
Fix quality issues seen on shared pages (e.g. `/shared/d9a8ebf2cc`) across:
- **PWA repo (`transmogrifia-pwa`)**: viewer rendering and share-time safeguards
- **Upstream transmogrifier pipeline (`transmogrifier-infra`)**: recipe prompts, content extraction, and image-selection policy

## Decisions Captured
- **Hero image policy:** Never generate a hero image if a source hero already exists. When substituting a source image with an AI one, *replace* — never show both.
- **Detritus cleanup policy:** Defense in depth — filter at extraction time AND instruct the AI to discard "related articles" sections. Remove only when confidence is high.
- **Byline/layout policy:** Enforce readable block layout both via recipe prompts (root cause) and via viewer CSS injection (defense in depth).
- **Execution scope:** Cross-repo plan (PWA + upstream).
- **PWA viewer CSS vs upstream prompt fix for byline float:** Do both. Viewer override catches existing articles; prompt fix prevents it in new ones.

## Problem Areas
1. **Mobile overflow** on iPhone 15 Pro Max — horizontal scrolling
2. **Redundant hero image** — AI generates hero alongside existing source hero
3. **Author bio floating left** on desktop — AI CSS floats byline block unpredictably
4. **Trailing "related articles" images** — unrelated thumbnails from recirculation sections leak through

---

## Implementation Plan

### Phase 1 — PWA Viewer Fixes (fastest user-visible impact)

#### 1.1 Fix mobile viewport overflow in shared viewer
**Root cause:** `shared-viewer.ts` injects minimal CSS overrides into the iframe, while `library.ts` has comprehensive media-clamping rules. The shared viewer is missing:
```css
img, video, iframe, embed, object, table, pre, code, svg {
  max-width: 100% !important;
  overflow-x: auto !important;
  box-sizing: border-box !important;
}
pre { white-space: pre-wrap !important; word-break: break-word !important; }
```

**File:** `src/screens/shared-viewer.ts` (style injection around line 113)

**Action:** Port the media-clamping rules from `library.ts` lines 617–623 into the shared viewer's `styleOverride` block. Keep the two in sync going forward.

#### 1.2 Normalize byline/author layout in shared viewer
**Root cause:** AI-generated CSS varies per invocation — sometimes floats or absolutely positions the author bio. No stable CSS class to target, but common patterns can be mitigated.

**File:** `src/screens/shared-viewer.ts` (style injection)

**Action:** Add defensive CSS guardrails in the injected `<style>`:
```css
/* Prevent author/byline blocks from floating outside reading column */
[class*="author"], [class*="byline"], [class*="bio"],
[class*="writer"], [class*="contributor"] {
  float: none !important;
  position: static !important;
  width: 100% !important;
  max-width: 100% !important;
  display: block !important;
}
```
Keep rules minimal — only override layout properties, not visual styling.

> Also add the same rules to `library.ts` for consistency.

#### 1.3 Add share-time safety checks (deferred — non-blocking)
Before publishing shared blobs, add lightweight heuristic validation:
- Detect duplicate hero/source combinations (two large images in first 500 chars of `<body>`)
- Detect suspicious trailing image galleries (3+ consecutive `<img>`/`<figure>` elements near end of `<body>` whose alt text looks like article headlines)

Start as telemetry/logging only (`console.warn`), promote to guardrails later.

**File:** `src/services/blob-storage.ts` — add a `validateShareHtml()` function called from `shareArticle()`

---

### Phase 2 — Upstream Prompt & Policy Fixes (`transmogrifier-infra`)

#### 2.1 Prevent redundant AI hero image
**Root cause:** The image instruction in `packages/core/src/recipes.ts` (line ~534) says AI images "COMPLEMENT" source images, but gives no explicit rule about the hero position. The AI is free to generate a hero even when a source hero already exists.

**File:** `packages/core/src/recipes.ts`

**Action:** Update `RESPONSE_FORMAT_WITH_IMAGES` (shared image instructions around line 334) and per-recipe `IMAGE GUIDELINES`:

> In the shared `RESPONSE_FORMAT_WITH_IMAGES` section, add after the "Be selective" line:
> - "Do NOT generate a hero image if the source content already has a prominent header/hero image near the top. Use the source image instead. Only generate a hero when no source image exists in the first few paragraphs."
> - "When you substitute a source image with an AI-generated version, REPLACE it — never show both the original and the AI version for the same editorial position."

In the Illustrated recipe's `IMAGE GUIDELINES` (around line 540):
> - Same instruction, reinforced: "If the source article already has a hero image, your 3–5 AI images should all be inline/accent — skip the hero slot."

#### 2.2 Constrain author bio layout in recipe prompts
**Root cause:** No recipe prompt mentions author bio layout. The AI improvises, sometimes using `float: left` with a profile image, causing the bio to sit beside body text on desktop.

**File:** `packages/core/src/recipes.ts`

**Action:** Add to the shared `RESPONSE_FORMAT` and `RESPONSE_FORMAT_WITH_IMAGES` HTML requirements (around line 165):
> - "Author bio/byline blocks must be full-width block elements (display: block or flex). NEVER float, absolutely position, or create multi-column layouts for author sections. They should span the full content column width."

Also add to the Reader recipe's layout section (around line 389):
> - "Author/byline: full-width, centered or left-aligned in the content column, never floated."

#### 2.3 Instruct AI to discard "related articles" content
**Root cause:** The existing DISCARD instruction (line ~178/288 in `recipes.ts`) lists navigation debris but doesn't mention related-article sections or their thumbnail images. The AI sees them as legitimate content.

**File:** `packages/core/src/recipes.ts`

**Action:** Expand the DISCARD instruction in both `RESPONSE_FORMAT` and `RESPONSE_FORMAT_WITH_IMAGES`:

> Add: "Also DISCARD: 'Related Articles' grids, 'More Stories' sections, 'Recommended For You' blocks, 'You Might Also Like' sections, and any recirculation modules with their associated thumbnail images. If there is a cluster of images near the end of the content whose alt text or captions reference articles with different titles/topics than the current article, they are recirculation thumbnails — discard them entirely."

---

### Phase 3 — Upstream Content Extraction Fixes (`transmogrifier-infra`)

#### 3.1 Expand `isInNonContentRegion()` with class/ID pattern matching
**Root cause:** `NON_CONTENT_ANCESTORS` only checks tag names (`aside`, `nav`, `footer`, `header`). Recirculation sections on Vox Media / The Verge use `<div>` or `<section>` with distinctive class names like `c-related-list`, `recirc`, `recommended`, etc.

**File:** `packages/api/src/shared/content-extractor.ts`

**Action:** Add class/ID pattern matching to `isInNonContentRegion()`:
```ts
const RECIRC_CLASS_PATTERNS = [
  /\brelated\b/i, /\brecommended\b/i, /\bmore[-_]?stories\b/i,
  /\brecirc\b/i, /\btrending\b/i, /\bpopular\b/i,
  /\bmost[-_]?read\b/i, /\balso[-_]?like\b/i, /\byou[-_]?might\b/i,
  /\bc-recirculation\b/i, /\bc-related\b/i,
];
```

Walk ancestors checking `className` and `id` against these patterns. This catches the vast majority of CMS recirculation widgets.

#### 3.2 Post-extraction detritus detection (confidence-based)
**File:** `packages/api/src/shared/content-extractor.ts`

**Action:** After Readability extraction and image reinsertion, add a heuristic pass:
- If the last N lines of content contain 3+ consecutive `[Image: ...]` references whose alt text looks like different article titles (heuristic: contain words not found in the current article's title, or match a "headline" pattern), flag or strip them.
- Use a confidence threshold — only strip when ≥3 consecutive images match and their alt texts are dissimilar to the article title.
- Log stripped images for monitoring during initial rollout.

#### 3.3 Unit tests for new extraction filters
Add tests for:
- `isInNonContentRegion()` matching class names like `c-related-list`, `recirc-module`
- `collectArticleImages()` skipping images inside recirculation containers
- Post-extraction heuristic stripping trailing image clusters
- Edge cases: legitimate multi-image articles (photo essays) should not be affected

---

### Phase 4 — Validation & Caching

#### 4.1 Validate cache/freshness behavior
Ensure route/API caching doesn't hide fixes for already-shared pages:
- `staticwebapp.config.json` — review rewrite rules for `/shared/*`
- Blob storage response headers — no aggressive `Cache-Control` on article blobs
- The SSR function (`api/shared-meta/`) caches `index.html` in-memory but re-fetches metadata per request — verify this is correct

#### 4.2 Build reproducible baseline
- Save the HTML payload from `d9a8ebf2cc` as a test fixture
- Add 2–3 similar problematic pages (Verge, NYT, etc.) as fixtures
- Automate a simple check: "no horizontal overflow", "no consecutive hero images", "no trailing recirc images"

#### 4.3 Regression verification
Manual verification on fixture set:
- iPhone 15 Pro Max: no horizontal scrolling
- Desktop: author bio spans full content width, not floated
- No AI hero when source hero exists
- No unrelated trailing source-image gallery
- Legitimate multi-image articles still render correctly

---

### Phase 5 — Extension Repo Fixes (`transmogrify-ext`)

#### 5.1 Add recirc filtering to browser-side content extractor
**Root cause:** The extension's `src/content/content-extractor.ts` has its own `isHiddenOrSkipped()` function with class/ID pattern matching for ads, popups, and sidebars — but not for recirculation/related-article sections. The same "related articles" thumbnails that leak through the API extractor also leak through the extension extractor.

**File:** `src/content/content-extractor.ts`

**Action:** Add the same recirculation class patterns from §3.1 to the extension's skip list:
```ts
// In the existing skip-patterns (alongside 'sidebar', 'advertisement', etc.)
'related', 'recommended', 'more-stories', 'recirc', 'recirculation',
'trending', 'popular', 'most-read', 'also-like', 'you-might-like',
'c-recirculation', 'c-related'
```

The extension's extractor runs in-browser with full DOM access (computed styles, rendered dimensions), so class-based filtering is sufficient — no need for the confidence-based heuristic (§3.2) that the API's noisier server-side extraction requires.

#### 5.2 Bump `@kypflug/transmogrifier-core` dependency
After the recipe prompt fixes (§2.1–2.3) land in `transmogrifier-infra` and a new version of `@kypflug/transmogrifier-core` is published, bump the extension's dependency to pick up the updated prompts (hero non-redundancy, byline layout constraints, DISCARD expansion). No code changes needed — just a version bump in `package.json`.

#### 5.3 Not needed in the extension
- **Mobile overflow (§1.1)** — Extension renders in desktop browser panels, not mobile viewports
- **Byline CSS guardrails (§1.2)** — Extension's sidebar/panel has constrained width where floated bylines are less problematic. Could add if seen in practice, but lower priority.
- **Share-time safety checks (§1.3)** — Sharing flows through the PWA's `blob-storage.ts`, not the extension
- **Post-extraction detritus heuristic (§3.2)** — The extension has full DOM context, so class-based filtering (§5.1) should be sufficient

---

## Suggested Work Order
1. **PWA viewer fixes** (§1.1, §1.2) — deploy first for immediate user impact
2. **Upstream recipe prompt fixes** (§2.1, §2.2, §2.3) — next, for root-cause fixes on new transmogrifications
3. **Upstream extraction fixes** (§3.1, §3.2, §3.3) — defense in depth against recirculation detritus
4. **Extension extraction fix** (§5.1) — parallelize with §3, same pattern list
5. **Extension core bump** (§5.2) — after §2 is published
6. **Share-time safeguards** (§1.3) — deferred, non-blocking
7. **Validation & regression** (§4.x) — final pass before release notes

## Risks / Notes
- Upstream fixes require changes in `transmogrifier-infra`, not this repo. Track separately.
- Extension recirc fix (§5.1) should be done in `transmogrify-ext`. Can parallelize with §3 since both add the same pattern list independently.
- Viewer-level CSS normalization must remain narrow to avoid breaking intended article layouts (e.g., legitimate multi-column designs).
- Confidence thresholds for detritus removal need tuning against real samples — start conservative, tighten over time.
- The byline CSS selectors (`[class*="author"]`, etc.) could catch false positives in article body text about authors — keep overrides to layout properties only (`float`, `position`, `width`), not visual styling.
- Re-transmogrifying existing articles with updated prompts only helps going forward. Already-shared pages need the viewer-side fixes.
- Photo essays with legitimate trailing image galleries must not be broken by the detritus heuristic — the "different article title" check is the key differentiator.
