# Auth, Sync, and Cache Reliability Overhaul Plan

## Overview
This plan hardens sign-in/session persistence (especially iOS), eliminates known sync-loss and divergence paths, and introduces a correctness-first sync model with observability.

Guiding decisions already applied:
- Server-guarded metadata writes (ETag + merge retry)
- Aggressive cross-instance propagation
- Explicit iOS notice + one-tap **Refresh from Cloud**
- Include an implementation-ready redesign RFC

The sequence is risk-layered:
1. Remove critical correctness bugs and listener/race hazards
2. Add cross-instance/state-coordination primitives
3. Implement stronger conflict/version semantics
4. Deliver redesign option to replace ad-hoc orchestration

---

## Steps

1. Stabilize article sync correctness in `src/services/graph.ts`
   - Ensure `bootstrapDeltaToken` only persists delta token after successful metadata materialization.
   - Add single-flight guard for concurrent sync calls from `loadArticles`/manual refresh/pending-job polling (`syncArticles`, `bootstrapDeltaToken`, `listArticles`).

2. Remove UI race conditions in `src/screens/library.ts`
   - Add open-request epoch/abort logic around `openArticle` so stale async completions cannot overwrite newer selection.
   - Gate iframe render/update by current request token.

3. Add lifecycle-safe event management in `src/screens/library.ts`, `src/screens/settings.ts`, and `src/main.ts`
   - Centralize attach/detach for global `document`/`window` listeners.
   - Prevent duplicate handlers after screen re-entry.

4. Harden auth recovery path in `src/services/auth.ts`
   - Fix interactive-fallback classification in `getAccessToken`.
   - Unify error taxonomy (`InteractionRequiredAuthError` vs browser/auth transient).
   - Make redirect recovery deterministic after iOS resume/kill.

5. Restrict MSAL cache backup scope in `src/services/msal-cache-backup.ts`
   - Backup/restore only durable account/token artifacts.
   - Exclude transient interaction/request keys.
   - Add restore validation and stale-snapshot guards.

6. Standardize storage access wrappers in `src/services/auth.ts`, `src/services/graph.ts`, `src/main.ts`, and `src/utils/storage.ts`
   - Remove raw localStorage accesses in auth-critical paths.
   - Normalize failure behavior under iOS/private-mode/storage pressure.

7. Implement server-guarded metadata writes in `src/services/graph.ts` and callers in `src/screens/library.ts`
   - Switch favorite/share metadata updates to ETag/If-Match conditional writes.
   - Add merge-and-retry strategy and user-safe conflict handling.

8. Add cross-instance propagation bus in `src/main.ts`, `src/screens/library.ts`, and `src/screens/settings.ts`
   - Use `BroadcastChannel` primary + storage-event fallback.
   - Publish/consume: `auth-changed`, `sync-complete`, `settings-updated`, `article-mutated`.

9. Add explicit iOS container-divergence UX in `src/screens/library.ts` + `src/styles/library.css`
   - Detect likely mismatch state.
   - Show concise notice.
   - Provide one-tap **Refresh from Cloud** action.

10. Strengthen settings sync semantics in `src/services/settings.ts` and `src/screens/settings.ts`
   - Reduce clock-skew risk by adding cloud revision metadata (or monotonic version token).
   - Add conflict-safe push/pull behavior.

11. Add production observability hooks in `src/services/auth.ts`, `src/services/graph.ts`, `src/services/cache.ts`, and `src/main.ts`
   - Structured event logs, sync counters, token lifecycle, IDB transaction failures, divergence detection metrics.

12. Produce implementation-ready redesign RFC
   - Define a `SyncCoordinator` architecture: single queue, deterministic state machine, local journal, conflict resolver, migration path from current orchestration.

---

## Verification

### Unit/Integration
- Delta-token commit conditions
- ETag conflict retry paths
- Auth recovery branches
- Listener teardown idempotence

### Manual Test Matrix
- Desktop browser (2 tabs)
- Desktop installed PWA + browser
- iOS Safari
- iOS installed PWA

### Scenarios
- Background / kill / relaunch
- Flaky network during delta bootstrap
- Concurrent favorite/share edits
- Cross-instance propagation correctness

### Commands
- `npm run build`
- `npx tsc --noEmit`
- Existing test runner (if configured)
- Deterministic repro scripts for sync/auth race cases

### Success Criteria
- No silent metadata loss across retries
- No duplicate global handlers
- No stale article render race
- Reduced unexpected sign-outs
- Bounded sync divergence between active instances

---

## Notes
This document is intended as both an execution checklist and planning artifact for phased implementation.
