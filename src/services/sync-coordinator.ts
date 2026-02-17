/**
 * SyncCoordinator — centralised sync orchestration (Fix 20).
 *
 * Replaces the ad-hoc sync logic previously embedded in `library.ts` with a
 * single module that owns:
 *   - Serialised sync operations (delta, index+bootstrap, full list)
 *   - A write queue with optimistic updates, retry + exponential backoff
 *   - Divergence detection (Fix 16)
 *   - Stale-sync fallback (Fix 15)
 *   - Cross-tab broadcast emission
 *   - Progress reporting via an event subscription model
 *
 * The coordinator does NOT own rendering — it emits events and lets the UI
 * layer (library.ts) subscribe and react.
 */

import type { OneDriveArticleMeta } from '../types';
import {
  syncArticles,
  clearDeltaToken,
  bootstrapDeltaToken,
  rebuildIndex,
  uploadMeta,
  deleteArticle as graphDeleteArticle,
  hasDeltaToken,
} from './graph';
import {
  getCachedMeta,
  getCachedHtmlIds,
  cacheAllMeta,
  cacheMeta,
  reconcileCache,
  mergeDeltaIntoCache,
  deleteCachedArticle,
  getSettingsValue,
  setSettingsValue,
} from './cache';
import { postBroadcast } from './broadcast';

// ─── Public types ───────────────────────────────────────────────────

export type CoordinatorEvent =
  | { type: 'sync-start' }
  | { type: 'sync-end' }
  | { type: 'articles-updated'; articles: OneDriveArticleMeta[]; cachedIds: Set<string> }
  | { type: 'sync-message'; message: string | null }
  | { type: 'divergence'; show: boolean }
  | { type: 'sync-error'; error: Error; hasCache: boolean }
  | { type: 'mutation-reverted'; articleId: string; error: Error };

type EventHandler = (event: CoordinatorEvent) => void;

interface PendingWrite {
  id: number;
  articleId: string;
  execute: () => Promise<void>;
  rollback: () => Promise<void>;
  retriesLeft: number;
  backoffMs: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const STALE_THRESHOLD = 60 * 60 * 1000;       // 1 hour  (Fix 15)
const DIVERGENCE_THRESHOLD = 60 * 60 * 1000;   // 1 hour  (Fix 16)
const MAX_WRITE_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;

// ─── Module state ───────────────────────────────────────────────────

let articles: OneDriveArticleMeta[] = [];
let cachedIds = new Set<string>();
let syncing = false;
const handlers = new Set<EventHandler>();
const writeQueue: PendingWrite[] = [];
let processingWrites = false;
let writeIdCounter = 0;

// ─── Event emission ─────────────────────────────────────────────────

function emit(event: CoordinatorEvent): void {
  for (const handler of handlers) {
    try { handler(event); } catch { /* listener error must not break coordinator */ }
  }
}

// ─── Public API: observation ────────────────────────────────────────

/** Subscribe to coordinator events. Returns an unsubscribe function. */
export function subscribe(handler: EventHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** Current article list (readonly snapshot). */
export function getArticles(): OneDriveArticleMeta[] {
  return articles;
}

/** Current set of article IDs with cached HTML. */
export function getCachedIds(): Set<string> {
  return cachedIds;
}

/** Whether a sync is in progress. */
export function isSyncing(): boolean {
  return syncing;
}

// ─── Public API: sync ───────────────────────────────────────────────

/**
 * Request a sync. Shows cached data immediately, then syncs with OneDrive.
 * If a sync is already in progress the call is silently skipped.
 */
export async function requestSync(): Promise<void> {
  if (syncing) {
    console.debug('[Sync] requestSync skipped — already in progress');
    return;
  }
  syncing = true;
  emit({ type: 'sync-start' });

  // 1. Show cached articles instantly
  const cached = await getCachedMeta();
  cachedIds = await getCachedHtmlIds();
  const hadCache = cached.length > 0;
  if (hadCache) {
    articles = cached;
    emit({ type: 'articles-updated', articles, cachedIds });
    // Fix 16: check divergence
    checkDivergence().catch(() => {});
  }

  // Fix 15: stale sync → force full
  const lastSync = await getSettingsValue<number>('lastSyncTime');
  if (!lastSync || (Date.now() - lastSync) > STALE_THRESHOLD) {
    console.debug('[Sync] Last sync is stale or absent — forcing full sync');
    await clearDeltaToken();
  }

  // 2. Sync via delta API (or article index)
  try {
    const delta = await syncArticles();
    console.debug(
      '[Sync] syncArticles result: fullSync=%s, usedIndex=%s, upserted=%d, deleted=%d',
      delta.fullSync, delta.usedIndex, delta.upserted.length, delta.deleted.length,
    );

    if (delta.fullSync) {
      if (delta.usedIndex) {
        // Index preview → bootstrap → reconcile (Fix 6)
        await cacheAllMeta(delta.upserted);
        articles = delta.upserted;
        cachedIds = await getCachedHtmlIds();
        emit({ type: 'articles-updated', articles, cachedIds });
        emit({ type: 'sync-message', message: 'Syncing…' });

        try {
          const knownIds = new Set(delta.upserted.map(a => a.id));
          const result = await bootstrapDeltaToken(knownIds);
          console.debug('[Sync] Bootstrap: newMetas=%d, deletedIds=%d',
            result.newMetas.length, result.deletedIds.length);

          const merged = [...delta.upserted, ...result.newMetas];
          const deletedSet = new Set(result.deletedIds);
          const final = merged.filter(a => !deletedSet.has(a.id));

          articles = await reconcileCache(final);
          cachedIds = await getCachedHtmlIds();
          for (const id of result.deletedIds) cachedIds.delete(id);
          emit({ type: 'articles-updated', articles, cachedIds });
          emit({ type: 'sync-message', message: null });

          rebuildIndex(articles).catch(() => {});
        } catch (err) {
          console.warn('[Sync] Bootstrap failed after index sync:', err);
          emit({ type: 'sync-message', message: null });
        }
      } else {
        // Full re-sync
        articles = await reconcileCache(delta.upserted);
        cachedIds = await getCachedHtmlIds();
        emit({ type: 'articles-updated', articles, cachedIds });
        rebuildIndex(articles).catch(() => {});
      }
    } else if (delta.upserted.length > 0 || delta.deleted.length > 0) {
      // Incremental delta merge
      articles = await mergeDeltaIntoCache(delta.upserted, delta.deleted);
      for (const id of delta.deleted) cachedIds.delete(id);
      emit({ type: 'articles-updated', articles, cachedIds });
      rebuildIndex(articles).catch(() => {});
    }
  } catch (err) {
    console.warn('[Sync] Background sync failed:', err);
    emit({ type: 'sync-error', error: err as Error, hasCache: hadCache });
  } finally {
    syncing = false;
    emit({ type: 'divergence', show: false });
    emit({ type: 'sync-end' });
    postBroadcast({ type: 'sync-complete' });
    setSettingsValue('lastSyncTime', Date.now()).catch(() => {});
  }
}

/**
 * Force a full sync by clearing the delta token first.
 * Used by the "Refresh from Cloud" button (Fix 16).
 */
export async function forceFullSync(): Promise<void> {
  await clearDeltaToken();
  return requestSync();
}

/**
 * Refresh the article list from IndexedDB cache without a network sync.
 * Used by cross-tab broadcast listeners.
 */
export async function refreshFromCache(): Promise<void> {
  const cached = await getCachedMeta();
  cachedIds = await getCachedHtmlIds();
  articles = cached;
  emit({ type: 'articles-updated', articles, cachedIds });
}

// ─── Public API: mutations ──────────────────────────────────────────

/**
 * Queue an optimistic mutation to an article's metadata.
 *
 * The `mutator` is applied immediately (for responsive UI), the change is
 * persisted to IndexedDB, then uploaded to OneDrive with automatic retry
 * on transient failures. On permanent failure the mutation is rolled back
 * locally and a `mutation-reverted` event is emitted.
 */
export function mutateArticle(
  articleId: string,
  mutator: (meta: OneDriveArticleMeta) => void,
  options?: {
    mergeFn?: (local: OneDriveArticleMeta, remote: OneDriveArticleMeta) => OneDriveArticleMeta;
  },
): void {
  const meta = articles.find(a => a.id === articleId);
  if (!meta) {
    console.warn('[Sync] mutateArticle: article %s not found', articleId);
    return;
  }

  // Snapshot for rollback
  const snapshot = JSON.parse(JSON.stringify(meta)) as OneDriveArticleMeta;

  // Optimistic update
  mutator(meta);
  meta.updatedAt = Date.now();

  // Persist to local cache immediately (fire-and-forget ok — IDB is reliable)
  cacheMeta(meta).catch(() => {});
  emit({ type: 'articles-updated', articles, cachedIds });

  const opId = ++writeIdCounter;
  writeQueue.push({
    id: opId,
    articleId,
    execute: async () => {
      await uploadMeta(meta, options?.mergeFn);
      rebuildIndex(articles).catch(() => {});
      postBroadcast({ type: 'article-mutated', articleId, action: 'upsert' });
    },
    rollback: async () => {
      Object.assign(meta, snapshot);
      await cacheMeta(meta);
      emit({ type: 'articles-updated', articles, cachedIds });
      emit({ type: 'mutation-reverted', articleId, error: new Error('Write failed after retries') });
    },
    retriesLeft: MAX_WRITE_RETRIES,
    backoffMs: INITIAL_BACKOFF_MS,
  });

  processWriteQueue();
}

/**
 * Queue an article deletion with retry.
 * Optimistically removes the article from the local list and cache.
 */
export async function removeArticle(articleId: string): Promise<void> {
  const idx = articles.findIndex(a => a.id === articleId);
  const snapshot = idx >= 0 ? (JSON.parse(JSON.stringify(articles[idx])) as OneDriveArticleMeta) : null;

  // Optimistic removal
  if (idx >= 0) articles.splice(idx, 1);
  cachedIds.delete(articleId);
  await deleteCachedArticle(articleId);
  emit({ type: 'articles-updated', articles, cachedIds });

  const opId = ++writeIdCounter;
  writeQueue.push({
    id: opId,
    articleId,
    execute: async () => {
      await graphDeleteArticle(articleId);
      rebuildIndex(articles).catch(() => {});
      postBroadcast({ type: 'article-mutated', articleId, action: 'delete' });
    },
    rollback: async () => {
      if (snapshot) {
        articles.push(snapshot);
        await cacheMeta(snapshot);
        emit({ type: 'articles-updated', articles, cachedIds });
      }
      emit({ type: 'mutation-reverted', articleId, error: new Error('Delete failed after retries') });
    },
    retriesLeft: MAX_WRITE_RETRIES,
    backoffMs: INITIAL_BACKOFF_MS,
  });

  processWriteQueue();
}

// ─── Public API: direct state updates ───────────────────────────────

/**
 * Directly set the articles list (e.g. after cache clear).
 * Does NOT trigger a sync — used for local state management.
 */
export function setArticles(newArticles: OneDriveArticleMeta[]): void {
  articles = newArticles;
  emit({ type: 'articles-updated', articles, cachedIds });
}

/**
 * Update cachedIds directly (e.g. after caching HTML for a single article).
 */
export function updateCachedIds(newIds: Set<string>): void {
  cachedIds = newIds;
}

// ─── Lifecycle ──────────────────────────────────────────────────────

/** Tear down all state. Call on sign-out or screen unmount. */
export function destroy(): void {
  handlers.clear();
  writeQueue.length = 0;
  articles = [];
  cachedIds = new Set();
  syncing = false;
  processingWrites = false;
}

// ─── Internal ───────────────────────────────────────────────────────

async function checkDivergence(): Promise<void> {
  const [hasToken, lastSync] = await Promise.all([
    hasDeltaToken(),
    getSettingsValue<number>('lastSyncTime'),
  ]);
  if (!hasToken && (!lastSync || (Date.now() - lastSync) > DIVERGENCE_THRESHOLD)) {
    emit({ type: 'divergence', show: true });
  }
}

/** Process the write queue sequentially with retry + backoff. */
async function processWriteQueue(): Promise<void> {
  if (processingWrites) return;
  processingWrites = true;

  while (writeQueue.length > 0) {
    const op = writeQueue[0];
    try {
      await op.execute();
      writeQueue.shift(); // success — remove
    } catch (err) {
      if (isRetryable(err) && op.retriesLeft > 0) {
        op.retriesLeft--;
        console.debug(
          '[Sync] Write op %d failed, retrying in %dms (%d left)',
          op.id, op.backoffMs, op.retriesLeft,
        );
        await delay(op.backoffMs);
        op.backoffMs *= 2; // exponential backoff
        // Loop continues — retry same op
      } else {
        // Permanent failure — rollback and dequeue
        writeQueue.shift();
        console.warn('[Sync] Write op %d permanently failed:', op.id, err);
        try {
          await op.rollback();
        } catch (rollbackErr) {
          console.error('[Sync] Rollback also failed:', rollbackErr);
        }
      }
    }
  }

  processingWrites = false;
}

/** Determine whether an error is worth retrying (network / 5xx / 429). */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network errors
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch')) return true;
  // 5xx server errors
  if (/\b5\d{2}\b/.test(msg)) return true;
  // 429 rate limit
  if (msg.includes('429') || msg.includes('too many requests')) return true;
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
