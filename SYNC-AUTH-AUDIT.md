# Auth, Sync & Cache — Merged Fix Plan

## Problems Reported

1. **Constantly getting signed out**, especially on iOS but also on desktop (after backgrounding & resuming)
2. **Articles don't reliably sync** between instances — the most recent articles are completely different across a signed-in browser and signed-in PWA on iOS

---

## Root Causes

### Auth Loss (Problem 1)

| ID | Issue | Severity |
|----|-------|----------|
| A1 | **`getAccessToken` error cascade never redirects for re-auth.** After `BrowserAuthError` retry with `forceRefresh` fails, code checks `err instanceof InteractionRequiredAuthError` — but `err` is a `BrowserAuthError`, so `acquireTokenRedirect` is never reached. User is stuck signed out with no recovery path. | Critical |
| A2 | **MSAL backup restores stale interaction state.** `msal-cache-backup.ts` snapshots `msal.interaction.status` and `msal.request.params` keys. Restoring these after an iOS process kill causes `interaction_in_progress` errors, blocking sign-in. | High |
| A3 | **Resume handler throttle too aggressive.** 2-minute throttle in `setupResumeHandler` skips critical token refreshes on iOS where the app is frequently killed and restarted. | Medium |

### Sync Divergence (Problem 2)

| ID | Issue | Severity |
|----|-------|----------|
| S1 | **Delta token in localStorage → constant full syncs on iOS.** iOS evicts localStorage, losing the delta token. Every resume triggers a full sync against the (potentially stale) article index. | Critical |
| S2 | **`_index.json` treated as an article.** The `.json` filter in `syncArticles`, `bootstrapDeltaToken`, and `listArticles` doesn't exclude `_index.json`. It becomes a phantom article with `id: "_index"`, corrupting the cache and rebuilt index. | High |
| S3 | **`bootstrapDeltaToken` saves delta token before downloads finish.** If metadata downloads partially fail, the token is already saved. Those articles are permanently invisible to future incremental syncs. | High |
| S4 | **`reconcileCache` destructively replaces cache with stale index.** On index-based sync, cache is wiped and replaced with index data before `bootstrapDeltaToken` runs. Articles added since the index was built disappear. | High |
| S5 | **No concurrent sync guard.** `loadArticles` can run concurrently (initial load + sync button + job polling), racing on delta token saves and cache mutations. | Medium |

### UI Race Conditions (both problems)

| ID | Issue | Severity |
|----|-------|----------|
| U1 | **`openArticle` race condition.** Rapidly clicking two articles can show stale content — the first download completes after the second is selected and overwrites the iframe. | Medium |
| U2 | **Duplicate global event handlers on screen re-entry.** `renderLibrary` adds `keydown`, `click`, `online`/`offline` listeners to `document`/`window` every time it's called. Navigating to settings and back stacks handlers, firing shortcuts multiple times. | Medium |

---

## Fix Plan

### Phase 1 — Critical Auth & Sync Fixes

These fix the root causes of sign-outs and data loss. Ship observability (Fix 18) alongside these fixes to validate impact.

| # | Fix | File(s) | Details |
|---|-----|---------|---------|
| 1 | **Fix `getAccessToken` error cascade** | `auth.ts` | After the `BrowserAuthError` → `forceRefresh` retry fails, explicitly call `acquireTokenRedirect` instead of falling through to a type check that never matches. This is the **primary** cause of "stuck signed out." |
| 2 | **Filter stale interaction state from MSAL backup** | `msal-cache-backup.ts` | Before writing the IndexedDB snapshot, exclude keys matching `interaction.status` or `request.params`. On restore, also strip these keys. Prevents restoring state that blocks sign-in. |
| 3 | **Move delta token to IndexedDB** | `graph.ts`, `cache.ts` | Replace `safeGetItem`/`safeSetItem` for `DELTA_TOKEN_KEY` with async IndexedDB reads/writes in the settings store. **Single most impactful sync fix** — prevents iOS from losing the delta token and forcing full syncs constantly. **Migration:** On first run, read the old localStorage value; if present, write it to IndexedDB and delete from localStorage. This avoids forcing a full sync on the first launch after deployment. |
| 4 | **Filter `_index.json` from article processing** | `graph.ts` | Add `if (name.startsWith('_')) continue;` to the delta loop in `syncArticles`, the `bootstrapDeltaToken` loop, and the `listArticles` loop. One-line fix, eliminates phantom `_index` article. |
| 5 | **Fix `bootstrapDeltaToken` premature delta token save** | `graph.ts` | Move delta token persistence to AFTER `downloadMetaBatch` completes. Only save if zero download failures, matching `syncArticles`'s behavior. |
| 6 | **Don't destructively reconcile on index-based sync** | `library.ts` | Show index data immediately as a **preview** (fast paint via `cacheAllMeta`), but keep the sync indicator spinning and show a subtle "Syncing…" label in the footer. Await `bootstrapDeltaToken` to completion. Then `reconcileCache` with the full merged set (index + bootstrap discoveries) and update the footer to "Synced." Only stop the sync indicator after bootstrap finishes. The preview-vs-synced distinction prevents users from misinterpreting temporary list state as authoritative. |
| 7 | **Add sync lock** | `library.ts` | Add a module-level `isSyncing` boolean. If `loadArticles` is already running, the second call returns immediately (or queues). Prevents concurrent delta token races. |
| 18 | **Production observability** _(ship with Phase 1)_ | `auth.ts`, `graph.ts`, `cache.ts`, `main.ts` | Add structured `console.debug` breadcrumbs alongside Phase 1 fixes to validate impact: `[Auth]` token lifecycle events (failure reason, recovery path taken), `[Sync]` delta-token source (IndexedDB vs localStorage migration vs fresh), bootstrap success/failure counts, `[Cache]` IDB transaction outcomes. **Log hygiene:** All logs must redact tokens and account identifiers — follow the existing pattern of `value.substring(0, 8) + '…'` for IDs; never log full access tokens, refresh tokens, or email addresses. |

### Phase 2 — UI Correctness & Cross-Instance

These fix UI races and add multi-tab/device awareness.

| # | Fix | File(s) | Details |
|---|-----|---------|---------|
| 8 | **Fix `openArticle` race** | `library.ts` | Add an epoch counter or `AbortController` to `openArticle`. When a new article is selected, increment the epoch. Before rendering the downloaded HTML, check if the epoch still matches — if not, discard the stale result. |
| 9 | **Centralize global event listener lifecycle** | `library.ts`, `settings.ts`, `main.ts` | Track all `document`/`window` listeners added by each screen. Tear them down when the screen is unmounted (on re-render or route change). Prevents handler accumulation on screen re-entry. |
| 10 | **BroadcastChannel cross-tab sync** | `main.ts`, `library.ts`, `settings.ts` | Use `BroadcastChannel` (with `storage` event fallback for Safari <15.4) to propagate `sync-complete`, `article-mutated`, `settings-updated`, and `auth-changed` events between tabs. When a tab receives `sync-complete`, refresh the article list from cache without a full Graph sync. |
| 11 | **ETag-guarded metadata writes** | `graph.ts`, `library.ts` | Switch `uploadMeta` (favorite toggle, share) to use `If-Match` with the article's ETag. On 412 conflict, re-download the server version, merge the change, and retry. Prevents last-write-wins data loss on concurrent edits from different devices. **Spike first:** Verify that Graph's `PUT` to `:/content` paths supports `If-Match` conditional writes. The upload path uses `graphContentUrl(articleMetaPath(id))` — test whether `If-Match` is honored or ignored on this endpoint before committing to the implementation shape. If not supported, fall back to download-merge-upload with a short retry window. |
| 12 | **Tune resume handler** | `main.ts` | Replace the 2-minute throttle with smarter logic: attempt a non-forced `acquireTokenSilent` on resume (cheap, uses cached token if valid). Only escalate to `forceRefresh: true` if it fails. Keep a hard floor of 30 seconds between any refresh attempts to avoid hammering. Don't key off ID token expiry alone — access token freshness and silent-acquire errors are the real triggers. |

### Phase 3 — Robustness & Observability

| # | Fix | File(s) | Details |
|---|-----|---------|---------|
| 13 | **Add "last synced" timestamp** | `library.ts`, `cache.ts` | Store `lastSyncTime` in IndexedDB after every successful sync. Display in sidebar footer (e.g., "Synced 3 min ago"). |
| 14 | **Move user preferences to IndexedDB** | `preferences.ts`, `cache.ts` | Sort/filter/theme/sidebar-width get wiped on iOS. Move to IndexedDB. Keep a localStorage fast-read cache for theme (to avoid FOUC on cold start). |
| 15 | **Full-resync fallback timer** | `library.ts`, `graph.ts` | If `lastSyncTime` is >1 hour old (or absent), force a delta token reset and full sync on next launch. Catches stale delta tokens. |
| 16 | **iOS divergence UX notice** | `library.ts`, `library.css` | Detect likely cache-vs-cloud mismatch (e.g., no delta token + stale `lastSyncTime`). Show a concise notice with a one-tap "Refresh from Cloud" button instead of silently serving stale data. |
| 17 | **Settings sync conflict semantics** | `settings.ts` | Add a monotonic version counter (or content hash) alongside `updatedAt` in the cloud settings envelope. Reduces clock-skew risk for conflict resolution. |
| 19 | **Service worker update coordination** | `main.ts`, `vite.config.ts` | `registerType: 'autoUpdate'` with `skipWaiting` can interrupt auth redirects. Add `onNeedRefresh` callback that defers SW activation until `handleRedirectPromise()` has completed. |

### Phase 4 — Aspirational: SyncCoordinator Architecture

| # | Fix | File(s) | Details |
|---|-----|---------|---------|
| 20 | **SyncCoordinator RFC & implementation** | New `services/sync-coordinator.ts` | Replace the ad-hoc orchestration in `loadArticles` with a single state-machine-driven sync queue. Responsibilities: serialized sync operations, local journal of pending writes, conflict resolution, retry with backoff, progress reporting. Migration path: wrap existing `syncArticles`/`bootstrapDeltaToken`/`reconcileCache` calls behind the coordinator, then incrementally move logic inward. |

---

## Priority & Sequencing

| Phase | Priority | Impact |
|-------|----------|--------|
| **Phase 1** (Fixes 1–7 + 18) | **Immediate** | Stops sign-outs and data loss. Fixes 1 + 3 alone resolve the majority of symptoms. Fix 4 is a one-liner with outsized impact. Observability ships alongside to validate. |
| **Phase 2** (Fixes 8–12) | **Next sprint** | Fixes visible UI glitches and enables multi-tab/device correctness. |
| **Phase 3** (Fixes 13–17, 19) | **Following sprint** | Prevents recurrence, improves diagnosability, adds user confidence signals. |
| **Phase 4** (Fix 20) | **When bandwidth allows** | Architectural cleanup. Not urgent if Phases 1–3 are done. |

### Rollout Strategy

This is a solo-dev PWA on Azure Static Web Apps — formal feature flags add complexity that doesn't pay off. Instead:

- **Ship Phase 1 as a single deployment.** Verify on iOS + desktop before proceeding.
- **Rollback:** Phase 1 changes are backward-compatible. The delta token migration (Fix 3) reads from localStorage first, so reverting code still works. The only state change is the IndexedDB write, which the old code simply ignores.
- **Phase 2 changes** (ETag writes, BroadcastChannel) are additive — they can be reverted individually without data loss.
- **If a fix causes regression:** revert that commit and redeploy. SWA deployments take <2 minutes.

---

## Verification Plan

### Automated
- `npm run build` / `npx tsc --noEmit` — no regressions
- Delta-token commit conditions (unit test)
- Auth recovery branches (unit test)
- ETag conflict retry paths (unit test)
- Listener teardown idempotence (unit test)
- Playwright WebKit scenario (aspirational) — basic auth flow + article list render. Note: Playwright's WebKit doesn't replicate iOS WKWebView's localStorage eviction or process kills, so this catches rendering/JS regressions but not the core iOS lifecycle issues. Real iOS device testing remains essential.

### Manual Test Matrix

| Platform | Scenarios |
|----------|-----------|
| Desktop browser (2 tabs) | Concurrent edits, BroadcastChannel propagation, handler stacking on route changes |
| Desktop installed PWA + browser | Cross-instance sync, concurrent favorite toggles |
| iOS Safari | Background/resume, localStorage eviction, auth recovery |
| iOS installed PWA | Same as Safari + standalone mode iframe restrictions |

### Key Scenarios
- Background app for >1 hour (token expiry) → resume → should stay signed in
- Background for 90+ days (refresh token expiry) → resume → should redirect to Microsoft login (not silently fail)
- Clear localStorage in DevTools → reload → should recover from IndexedDB backup
- Create article on device A → sync on device B → article appears
- Rapidly click 3 articles → correct (last-clicked) article renders
- Navigate library → settings → library → keyboard shortcuts fire exactly once
- Force-close iOS PWA mid-redirect-flow → reopen → sign-in completes or cleanly retries
- First launch after Phase 1 deployment → delta token migrates from localStorage to IndexedDB without a full sync

### Success Criteria
- No silent sign-outs after backgrounding
- No phantom `_index` article in the list
- Article lists converge across devices within one manual sync
- No stale article rendered after rapid selection
- No duplicate keyboard shortcut firings
- Bounded sync divergence between active instances
- Observability logs confirm: auth recovery path taken, delta token source, bootstrap success rate

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **IndexedDB for delta token** (not cookies) | Cookies have size limits and are sent with every request. IndexedDB is the right durable store and already used for article cache. |
| **One-time localStorage → IndexedDB migration** | Without migration, first launch after deployment loses the existing delta token and forces a full sync for every user. Read once → promote → clear. |
| **Keep index optimization as fast preview** | The `_index.json` provides real first-load speed value, but must not destructively replace the cache. Show it immediately as a "preview" state, then finalize with delta to reach "synced" state. |
| **Redirect-based re-auth** (not popup) | Popups are blocked in PWA standalone mode on iOS. Redirect is the only reliable interactive flow. |
| **`storeAuthStateInCookie` dropped** | Deprecated and removed in MSAL v5 (removed in this repo at v0.10.7). Not a viable fix path. Redirect state resilience handled by the MSAL backup + interaction state filtering instead. |
| **ETag merge-retry over last-write-wins** | Unconditional PUT on metadata is a silent data loss vector when two devices edit simultaneously. ETag + merge is the correct approach for a multi-device app. Requires endpoint verification spike first. |
| **BroadcastChannel over polling** | Instant cross-tab propagation without periodic timer overhead. `storage` event fallback covers older Safari. |
| **Observability ships with fixes, not before** | The auth cascade bug (Fix 1) is unambiguously the cause of sign-outs — blocking on telemetry would delay a critical fix for data we don't need. Counters ship alongside to validate, not gate. |
| **No formal feature flags** | Solo-dev PWA with <2-minute deploy cycles. Phased rollout + per-commit revert is the practical equivalent. Feature flag infrastructure would add complexity without proportional value. |
| **Playwright WebKit is aspirational** | It doesn't replicate iOS process lifecycle, which is where the real bugs live. Useful for JS/rendering regression but not a substitute for real device testing. |
| **Log redaction by default** | New logs follow existing `substring(0, 8) + '…'` pattern for IDs. Never log full tokens or email addresses. |