/**
 * Google Auth Provider for Library of Transmogrifia
 *
 * Implements OAuth 2.0 Authorization Code flow with PKCE for Google accounts.
 * Uses Google Drive App Data scope for article storage, mirroring the OneDrive
 * approach used by the Microsoft provider.
 *
 * Token lifecycle:
 *  - Access tokens are stored in localStorage with an expiry timestamp.
 *  - Refresh tokens are persisted for silent renewal.
 *  - IndexedDB backup (via token-backup.ts) protects against iOS localStorage eviction.
 *  - Account hint (email + name) is saved separately for re-authentication UX.
 */

import type { AuthProvider, ProviderAccountInfo, AuthRedirectResult } from '../types';
import {
  backupGoogleTokens,
  clearGoogleTokenBackup,
  restoreGoogleTokensIfNeeded,
  setupGoogleTokenBackup,
} from './token-backup';

// ─── Constants ──────────────────────────────────────────────────────

const CLIENT_ID = '896663119069-nq0ur8ed7c7td44v6o29gu3qdr9t1un7.apps.googleusercontent.com';
const REDIRECT_URI = window.location.origin + '/';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid profile email';

// ─── localStorage Keys ─────────────────────────────────────────────

const KEY_ACCESS_TOKEN = 'transmogrifia_google_access_token';
const KEY_REFRESH_TOKEN = 'transmogrifia_google_refresh_token';
const KEY_TOKEN_EXPIRY = 'transmogrifia_google_token_expiry';
const KEY_ID_TOKEN = 'transmogrifia_google_id_token';
const KEY_CODE_VERIFIER = 'transmogrifia_google_code_verifier';
const KEY_ACCOUNT_HINT = 'transmogrifia_google_account_hint';

// ─── PKCE Helpers ───────────────────────────────────────────────────

/** Base64url-encode a byte array (no padding). */
function base64UrlEncode(bytes: Uint8Array): string {
  const binString = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a cryptographically random code verifier (RFC 7636). */
function generateCodeVerifier(): string {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

/** Derive the S256 code challenge from a code verifier (RFC 7636). */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// ─── localStorage Wrappers ──────────────────────────────────────────

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* */ }
}

// ─── Token Response Types ───────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
  refresh_token?: string;
  scope?: string;
}

interface IdTokenPayload {
  sub: string;
  name: string;
  email: string;
}

interface AccountHint {
  email: string;
  name: string;
}

// ─── GoogleAuthProvider ─────────────────────────────────────────────

export class GoogleAuthProvider implements AuthProvider {
  readonly type = 'google' as const;

  /** Cached user ID from ID token `sub` claim. */
  private cachedUserId: string | null = null;

  /**
   * Initialise the Google auth provider and process any pending auth redirect.
   *
   * Checks the URL for `?code=` (returning from Google auth redirect) or
   * `?error=` (user denied consent). If a code is present, exchanges it for
   * tokens and returns the account info.
   *
   * On iOS cold restarts, localStorage may have been wiped — we restore from
   * IndexedDB backup first.
   *
   * @param force Re-process even if no redirect params are present (iOS resume).
   */
  async init(force?: boolean): Promise<AuthRedirectResult | null> {
    // Attempt to restore tokens from IndexedDB if localStorage was wiped
    const restored = await restoreGoogleTokensIfNeeded();
    if (restored) {
      console.info('[GoogleAuth] Tokens restored from IndexedDB backup');
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    // Handle auth error redirect (user denied consent, etc.)
    if (error) {
      console.warn('[GoogleAuth] Auth redirect error:', error, params.get('error_description'));
      this.cleanUrl();
      return null;
    }

    // Handle successful auth redirect — exchange code for tokens
    if (code) {
      try {
        await this.exchangeCodeForTokens(code);
        this.cleanUrl();
        const account = this.getAccount();
        if (account) {
          console.info('[GoogleAuth] Sign-in complete:', account.username);
          backupGoogleTokens().catch(() => {});
          return { account };
        }
      } catch (err) {
        console.error('[GoogleAuth] Token exchange failed:', err);
        this.cleanUrl();
        return null;
      }
    }

    // No redirect — check for existing session
    if (force || this.isSignedIn()) {
      const account = this.getAccount();
      if (account) {
        return { account };
      }
    }

    return null;
  }

  /**
   * Start the Google sign-in flow via redirect.
   *
   * Generates PKCE code_verifier/challenge, builds the authorization URL,
   * and redirects the browser. The page navigates away — this method
   * effectively never returns.
   */
  async signIn(): Promise<ProviderAccountInfo | null> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Persist code_verifier for the token exchange after redirect
    storageSet(KEY_CODE_VERIFIER, codeVerifier);

    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    console.debug('[GoogleAuth] Redirecting to Google sign-in');
    window.location.href = authUrl.toString();

    // Page navigates away; this code won't continue.
    return null;
  }

  /**
   * Sign the user out and clear all cached tokens.
   * Clears localStorage, IndexedDB backup, and cached user ID,
   * then redirects to the app root.
   */
  async signOut(): Promise<void> {
    this.clearAllStoredTokens();
    this.clearCachedUserId();
    await clearGoogleTokenBackup().catch(() => {});

    console.info('[GoogleAuth] Signed out');
    window.location.href = REDIRECT_URI;
  }

  /**
   * Get a valid access token, refreshing silently if needed.
   *
   * Checks the stored token expiry — if the token is still valid (with a
   * 5-minute buffer), returns it directly. Otherwise attempts a silent
   * refresh using the refresh token.
   *
   * @throws Error if no tokens are available or refresh fails.
   */
  async getAccessToken(): Promise<string> {
    const accessToken = storageGet(KEY_ACCESS_TOKEN);
    const expiryStr = storageGet(KEY_TOKEN_EXPIRY);

    if (accessToken && expiryStr) {
      const expiry = parseInt(expiryStr, 10);
      // Use 5-minute buffer to avoid using tokens that are about to expire
      const bufferMs = 5 * 60 * 1000;
      if (Date.now() < expiry - bufferMs) {
        console.debug('[GoogleAuth] Using cached access token, expires: %s',
          new Date(expiry).toISOString());
        return accessToken;
      }
    }

    // Token is expired or missing — attempt silent refresh
    console.debug('[GoogleAuth] Access token expired or missing, attempting refresh');
    return this.refreshAccessToken();
  }

  /**
   * Get the current account info from the stored account hint.
   * Returns null if no account hint exists.
   */
  getAccount(): ProviderAccountInfo | null {
    const hint = this.getAccountHint();
    if (!hint) return null;

    const idToken = storageGet(KEY_ID_TOKEN);
    let sub = '';
    if (idToken) {
      try {
        const payload = this.parseIdToken(idToken);
        sub = payload.sub;
      } catch {
        // ID token may be malformed — fall back to empty
      }
    }

    return {
      id: sub,
      name: hint.name,
      username: hint.email,
      homeAccountId: '', // MSAL-specific, not applicable for Google
      localAccountId: sub,
    };
  }

  /**
   * Whether the user is currently signed in.
   *
   * Returns true if we have an access token AND either a refresh token or
   * a non-expired access token. The refresh token allows silent renewal
   * even if the access token has expired.
   */
  isSignedIn(): boolean {
    const hasAccessToken = storageGet(KEY_ACCESS_TOKEN) !== null;
    const hasRefreshToken = storageGet(KEY_REFRESH_TOKEN) !== null;

    if (!hasAccessToken) return false;

    // If we have a refresh token, we can recover even from expired access tokens
    if (hasRefreshToken) return true;

    // No refresh token — check if access token is still valid
    const expiryStr = storageGet(KEY_TOKEN_EXPIRY);
    if (expiryStr) {
      return Date.now() < parseInt(expiryStr, 10);
    }

    return false;
  }

  /** The signed-in user's display name (empty string if not signed in). */
  getUserDisplayName(): string {
    const hint = this.getAccountHint();
    return hint?.name || '';
  }

  /**
   * Get the user's unique identifier for encryption key derivation.
   *
   * Extracts the `sub` claim from the stored ID token. Falls back to
   * fetching the userinfo endpoint if the ID token is unavailable.
   * Cached in memory after first resolution (same pattern as MSAL's
   * cachedGraphUserId).
   */
  async getUserId(): Promise<string | null> {
    if (!this.isSignedIn()) return null;

    if (this.cachedUserId) return this.cachedUserId;

    // Try extracting from stored ID token first
    const idToken = storageGet(KEY_ID_TOKEN);
    if (idToken) {
      try {
        const payload = this.parseIdToken(idToken);
        if (payload.sub) {
          this.cachedUserId = payload.sub;
          console.log('[GoogleAuth] userId from ID token:', this.cachedUserId.substring(0, 8) + '…');
          return this.cachedUserId;
        }
      } catch (err) {
        console.warn('[GoogleAuth] Failed to parse ID token, falling back to userinfo:', err);
      }
    }

    // Fallback: fetch from userinfo endpoint
    try {
      const token = await this.getAccessToken();
      const res = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn('[GoogleAuth] Userinfo request failed:', res.status);
        return null;
      }
      const info: { sub: string } = await res.json();
      this.cachedUserId = info.sub;
      console.log('[GoogleAuth] userId from userinfo:', this.cachedUserId.substring(0, 8) + '…');
      return this.cachedUserId;
    } catch (err) {
      console.warn('[GoogleAuth] Error fetching userId:', err);
      return null;
    }
  }

  /** Clear the cached user ID (call on sign-out). */
  clearCachedUserId(): void {
    this.cachedUserId = null;
  }

  /** Whether we have evidence of a previous sign-in session. */
  hasAccountHint(): boolean {
    return storageGet(KEY_ACCOUNT_HINT) !== null;
  }

  /**
   * Attempt to silently recover auth after an iOS cold restart.
   *
   * Checks for a refresh token in localStorage (possibly restored from
   * IndexedDB backup) and tries to obtain a fresh access token.
   *
   * Returns true if auth was recovered successfully.
   */
  async tryRecoverAuth(): Promise<boolean> {
    // First, try restoring from IndexedDB if localStorage was wiped
    await restoreGoogleTokensIfNeeded();

    const refreshToken = storageGet(KEY_REFRESH_TOKEN);
    if (!refreshToken) {
      console.debug('[GoogleAuth] No refresh token available for recovery');
      return false;
    }

    try {
      await this.refreshAccessToken();
      console.info('[GoogleAuth] Auth recovery succeeded via refresh token');
      backupGoogleTokens().catch(() => {});
      return true;
    } catch (err) {
      console.debug('[GoogleAuth] Auth recovery failed:', (err as Error).message);
      return false;
    }
  }

  /**
   * Proactively refresh the access token when the app resumes from background.
   * Non-critical — log and swallow errors so callers aren't disrupted.
   */
  async refreshTokenOnResume(): Promise<void> {
    try {
      await this.getAccessToken();
      console.debug('[GoogleAuth] Resume: token refreshed successfully');
    } catch {
      // Not critical — the next getAccessToken() call will handle refresh
      console.debug('[GoogleAuth] Resume: token refresh failed — will recover on next API call');
    }
  }

  /**
   * Redirect for sign-in using saved account hint (auto-redirect).
   *
   * Same as signIn() but with `login_hint` parameter pre-filled from the
   * stored account email, and without `prompt=consent` so Google can
   * auto-sign-in if only one session is active.
   */
  async signInWithHint(): Promise<void> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    storageSet(KEY_CODE_VERIFIER, codeVerifier);

    const hint = this.getAccountHint();

    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');

    // Use login_hint for seamless re-authentication; omit prompt=consent
    if (hint?.email) {
      authUrl.searchParams.set('login_hint', hint.email);
    }

    console.debug('[GoogleAuth] Redirecting to Google sign-in with hint');
    window.location.href = authUrl.toString();
  }

  /**
   * Register listeners to back up auth tokens before the process is killed.
   * Called once after entering the app (sign-in confirmed).
   */
  setupBackgroundBackup(): void {
    setupGoogleTokenBackup();
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Exchange an authorization code for tokens.
   * Called when the page loads with a `?code=` parameter after the Google
   * auth redirect.
   */
  private async exchangeCodeForTokens(code: string): Promise<void> {
    const verifier = storageGet(KEY_CODE_VERIFIER);
    if (!verifier) {
      throw new Error('Missing code_verifier — auth flow may have been interrupted');
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${errorBody}`);
    }

    const tokens: TokenResponse = await res.json();
    this.saveTokens(tokens);

    // Remove the transient code_verifier
    storageRemove(KEY_CODE_VERIFIER);

    // Save account hint from ID token
    if (tokens.id_token) {
      try {
        const payload = this.parseIdToken(tokens.id_token);
        this.saveAccountHint({ email: payload.email, name: payload.name });
      } catch (err) {
        console.warn('[GoogleAuth] Failed to parse ID token for account hint:', err);
      }
    }

    console.debug('[GoogleAuth] Token exchange complete, expires in %ds', tokens.expires_in);
  }

  /**
   * Refresh the access token using the stored refresh token.
   *
   * Note: Google's refresh response does NOT include a new refresh_token,
   * so we only update the access token and expiry.
   *
   * @throws Error if no refresh token is available or the refresh request fails.
   */
  private async refreshAccessToken(): Promise<string> {
    const refreshToken = storageGet(KEY_REFRESH_TOKEN);
    if (!refreshToken) {
      throw new Error('No refresh token available — user must sign in again');
    }

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      // If the refresh token has been revoked, clear all tokens to prevent retry loops
      if (res.status === 400 || res.status === 401) {
        console.warn('[GoogleAuth] Refresh token rejected, clearing stored tokens');
        storageRemove(KEY_ACCESS_TOKEN);
        storageRemove(KEY_TOKEN_EXPIRY);
        storageRemove(KEY_REFRESH_TOKEN);
        storageRemove(KEY_ID_TOKEN);
      }
      throw new Error(`Token refresh failed (${res.status}): ${errorBody}`);
    }

    const tokens: TokenResponse = await res.json();

    // Update access token and expiry (refresh response doesn't include a new refresh_token)
    storageSet(KEY_ACCESS_TOKEN, tokens.access_token);
    storageSet(KEY_TOKEN_EXPIRY, String(Date.now() + tokens.expires_in * 1000));

    if (tokens.id_token) {
      storageSet(KEY_ID_TOKEN, tokens.id_token);
    }

    // Keep IndexedDB backup fresh after every successful token refresh
    backupGoogleTokens().catch(() => {});

    console.debug('[GoogleAuth] Token refreshed, expires in %ds', tokens.expires_in);
    return tokens.access_token;
  }

  /** Save token response fields to localStorage. */
  private saveTokens(tokens: TokenResponse): void {
    storageSet(KEY_ACCESS_TOKEN, tokens.access_token);
    storageSet(KEY_TOKEN_EXPIRY, String(Date.now() + tokens.expires_in * 1000));

    if (tokens.id_token) {
      storageSet(KEY_ID_TOKEN, tokens.id_token);
    }
    if (tokens.refresh_token) {
      storageSet(KEY_REFRESH_TOKEN, tokens.refresh_token);
    }
  }

  /**
   * Parse a Google ID token JWT and extract key claims.
   * Only decodes the payload — does NOT verify the signature (the token
   * was received directly from Google's token endpoint over HTTPS).
   */
  private parseIdToken(idToken: string): IdTokenPayload {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid ID token format');
    }
    // Base64url → standard Base64 for atob()
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      sub: payload.sub,
      name: payload.name || '',
      email: payload.email || '',
    };
  }

  /** Read the saved account hint from localStorage. */
  private getAccountHint(): AccountHint | null {
    const raw = storageGet(KEY_ACCOUNT_HINT);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AccountHint;
    } catch {
      return null;
    }
  }

  /** Persist account hint for re-authentication UX. */
  private saveAccountHint(hint: AccountHint): void {
    storageSet(KEY_ACCOUNT_HINT, JSON.stringify(hint));
  }

  /** Remove the URL query parameters left by the auth redirect. */
  private cleanUrl(): void {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, document.title, url.toString());
  }

  /** Clear all Google auth keys from localStorage. */
  private clearAllStoredTokens(): void {
    storageRemove(KEY_ACCESS_TOKEN);
    storageRemove(KEY_REFRESH_TOKEN);
    storageRemove(KEY_TOKEN_EXPIRY);
    storageRemove(KEY_ID_TOKEN);
    storageRemove(KEY_CODE_VERIFIER);
    storageRemove(KEY_ACCOUNT_HINT);
  }
}

// ─── Factory ────────────────────────────────────────────────────────

export function createGoogleAuth(): GoogleAuthProvider {
  return new GoogleAuthProvider();
}
