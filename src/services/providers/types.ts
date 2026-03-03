/**
 * Provider Interfaces for Library of Transmogrifia
 *
 * These interfaces define the contract that auth and storage providers must
 * implement. The existing `auth.ts` and `graph.ts` become thin facades that
 * delegate to the active provider, so all consumers remain unchanged.
 */

import type { OneDriveArticleMeta, UserProfile } from '../../types';
import type { SyncEncryptedEnvelope, LegacyEncryptedEnvelope } from '../crypto';

// ─── Auth Provider ──────────────────────────────────────────────────

export type AuthProviderType = 'microsoft' | 'google';

/**
 * Minimal account info returned by auth providers.
 * Superset of the fields consumers actually use.
 */
export interface ProviderAccountInfo {
  /** Provider-assigned account identifier */
  id: string;
  /** User's display name */
  name: string;
  /** User's email / username */
  username: string;
  /** Home account ID (MSAL-specific, empty string for Google) */
  homeAccountId: string;
  /** Local account ID (MSAL-specific, same as `id` for Google) */
  localAccountId: string;
}

/**
 * Result returned from `init()` when the page load is returning from
 * an auth redirect (login or token acquisition).
 */
export interface AuthRedirectResult {
  account: ProviderAccountInfo | null;
}

export interface AuthProvider {
  readonly type: AuthProviderType;

  /**
   * Initialise the auth library and process any pending redirect response.
   * Returns non-null when this page load is returning from a redirect login.
   * @param force Re-process redirect even if already handled (iOS resume).
   */
  init(force?: boolean): Promise<AuthRedirectResult | null>;

  /** Start the sign-in flow (redirects away from the page). */
  signIn(): Promise<ProviderAccountInfo | null>;

  /** Sign the user out and clear all cached tokens. */
  signOut(): Promise<void>;

  /** Get a valid access token, refreshing silently if needed. */
  getAccessToken(): Promise<string>;

  /** Get the current account, or null if not signed in. */
  getAccount(): ProviderAccountInfo | null;

  /** Whether the user is currently signed in. */
  isSignedIn(): boolean;

  /** The signed-in user's display name (empty string if not signed in). */
  getUserDisplayName(): string;

  /**
   * Get the user's unique identifier for encryption key derivation.
   * Microsoft: Graph /me id. Google: `sub` from ID token.
   */
  getUserId(): Promise<string | null>;

  /** Clear the cached user ID (call on sign-out). */
  clearCachedUserId(): void;

  /** Whether we have evidence of a previous sign-in session. */
  hasAccountHint(): boolean;

  /**
   * Attempt to silently recover auth after an iOS cold restart.
   * Returns true if auth was recovered successfully.
   */
  tryRecoverAuth(): Promise<boolean>;

  /** Proactively refresh the access token when the app resumes from background. */
  refreshTokenOnResume(): Promise<void>;

  /** Redirect for sign-in using saved account hint (auto-redirect). */
  signInWithHint(): Promise<void>;

  /**
   * Register listeners to back up auth tokens before the process is killed.
   * Called once after entering the app.
   */
  setupBackgroundBackup(): void;
}

// ─── Storage Provider ───────────────────────────────────────────────

/** Result of a sync operation (delta or full). */
export interface DeltaSyncResult {
  /** Updated or new article metadata */
  upserted: OneDriveArticleMeta[];
  /** IDs of deleted articles */
  deleted: string[];
  /** True when the entire article list was fetched (not incremental) */
  fullSync: boolean;
  /** True when the result came from the article index */
  usedIndex: boolean;
}

/** Result of bootstrapping a delta/change token from a full sync. */
export interface BootstrapResult {
  /** Articles found in the delta that were NOT in the index */
  newMetas: OneDriveArticleMeta[];
  /** Article IDs that were deleted since the index was built */
  deletedIds: string[];
}

/** Shape of the encrypted settings file stored in the cloud. */
export interface CloudSettingsFile {
  envelope: SyncEncryptedEnvelope | LegacyEncryptedEnvelope;
  updatedAt: number;
  /** Monotonic version counter for clock-skew-safe conflict resolution */
  syncVersion?: number;
}

export interface StorageProvider {
  readonly type: AuthProviderType;

  /**
   * Sync articles using incremental change tracking.
   * On first call (no saved token), tries the article index for a fast sync.
   * On subsequent calls, only returns changes since the last sync.
   */
  syncArticles(): Promise<DeltaSyncResult>;

  /** List all article metadata (full enumeration). */
  listArticles(): Promise<OneDriveArticleMeta[]>;

  /** Download article HTML content. */
  downloadArticleHtml(id: string): Promise<string>;

  /**
   * Upload updated metadata (e.g., favorite toggle).
   * @param mergeFn Optional merge function for conflict resolution.
   */
  uploadMeta(
    meta: OneDriveArticleMeta,
    mergeFn?: (local: OneDriveArticleMeta, remote: OneDriveArticleMeta) => OneDriveArticleMeta,
  ): Promise<void>;

  /** Delete an article (metadata + HTML + assets). */
  deleteArticle(id: string): Promise<void>;

  /** Download a binary asset (e.g., stored images). */
  downloadArticleAsset(path: string): Promise<Blob>;

  /** Rebuild and upload the article index. */
  rebuildIndex(articles: OneDriveArticleMeta[]): Promise<void>;

  /**
   * After an index-based sync, page through changes to get a delta token
   * and discover any articles added/deleted since the index was built.
   */
  bootstrapDeltaToken(knownIds: Set<string>): Promise<BootstrapResult>;

  /** Clear the saved delta/change token. */
  clearDeltaToken(): Promise<void>;

  /** Check whether a delta/change token exists. */
  hasDeltaToken(): Promise<boolean>;

  /** Download encrypted settings from cloud storage. */
  downloadSettings(): Promise<CloudSettingsFile | null>;

  /** Upload encrypted settings to cloud storage. */
  uploadSettings(envelope: SyncEncryptedEnvelope, updatedAt: number, syncVersion?: number): Promise<void>;

  /** Fetch the signed-in user's profile. */
  getUserProfile(): Promise<UserProfile>;
}
