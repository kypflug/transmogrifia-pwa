import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
  InteractionRequiredAuthError,
  BrowserAuthError,
} from '@azure/msal-browser';
import { backupMsalCache, clearMsalCacheBackup } from './msal-cache-backup';

const CLIENT_ID = '4b54bcee-1c83-4f52-9faf-d0dfd89c5ac2';
const REDIRECT_URI = window.location.origin + '/';

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: 'https://login.microsoftonline.com/consumers',
    redirectUri: REDIRECT_URI,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
};

const LOGIN_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access'];

/** localStorage key for our own account marker (iOS recovery). */
const ACCOUNT_HINT_KEY = 'transmogrifia_account_hint';

let msalInstance: PublicClientApplication | null = null;
let redirectHandled = false;

/**
 * Initialise MSAL and process any redirect response.
 *
 * Returns the AuthenticationResult from `handleRedirectPromise()` if the page
 * is loading after a redirect login — callers (main.ts) should check this to
 * know whether the user just signed in via redirect.
 *
 * On iOS standalone PWA, loginRedirect opens an in-app Safari sheet rather
 * than navigating the page. When the sheet closes, the PWA resumes without
 * reloading. Calling initAuth() again with `force: true` re-processes
 * handleRedirectPromise() to pick up the cached auth response.
 *
 * iOS recovery: iOS kills the WKWebView process aggressively when the PWA is
 * backgrounded. On cold restart, `handleRedirectPromise()` may encounter stale
 * interaction state and clear MSAL's in-memory account cache as a side effect.
 * When that happens and we previously had a signed-in user (account hint in
 * localStorage), we clean up the stale state and re-create the MSAL instance
 * so the second initialisation loads accounts cleanly.
 */
export async function initAuth(force = false): Promise<AuthenticationResult | null> {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();
  } else if (redirectHandled && !force) {
    // Already initialised and redirect was processed — nothing to do
    return null;
  }

  // handleRedirectPromise() MUST be called on every page load.
  // It returns non-null when the page is loading after a loginRedirect / acquireTokenRedirect.
  try {
    const response = await msalInstance.handleRedirectPromise();
    redirectHandled = true;

    // Persist account hint on successful redirect sign-in
    if (response?.account) {
      saveAccountHint(response.account);
      // Mirror MSAL cache to IndexedDB (iOS localStorage durability)
      backupMsalCache().catch(() => {});
    }

    return response;
  } catch (err) {
    console.warn('handleRedirectPromise failed (non-fatal):', err);
    // Clear any stale interaction state that could block future sign-in attempts
    cleanUpStaleState();

    // iOS recovery: if we had an account before the process kill, MSAL may
    // have cleared its in-memory cache while processing stale redirect state.
    // Re-create the instance so the next getAllAccounts() reads from a clean
    // localStorage without stale interaction entries interfering.
    if (hasAccountHint()) {
      console.debug('iOS recovery: re-creating MSAL instance after stale state cleanup');
      msalInstance = new PublicClientApplication(msalConfig);
      await msalInstance.initialize();
      redirectHandled = true;
    }

    return null;
  }
}

/**
 * Remove stale MSAL interaction-in-progress keys from localStorage.
 * Failed redirects or interrupted popup flows can leave these behind,
 * causing subsequent sign-in attempts to fail with interaction_in_progress.
 */
function cleanUpStaleState(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('interaction.status') || key.includes('request.params'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    if (keysToRemove.length > 0) {
      console.debug('Cleared stale MSAL state:', keysToRemove);
    }
  } catch {
    // localStorage may be unavailable
  }
}

/** Get the MSAL instance, assuming initAuth() has been called. */
function getMsal(): PublicClientApplication {
  if (!msalInstance) throw new Error('MSAL not initialised — call initAuth() first');
  return msalInstance;
}

export function getAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    saveAccountHint(accounts[0]);
    return accounts[0];
  }
  return null;
}

/**
 * Sign the user in via redirect.
 *
 * Uses loginRedirect on all platforms — it's the most reliable auth flow
 * for PWAs. The page navigates to Microsoft login, then back to the app.
 * On return, handleRedirectPromise() in initAuth() processes the response.
 *
 * Returns null since the page navigates away — callers should not proceed.
 */
export async function signIn(): Promise<AccountInfo | null> {
  const msal = getMsal();
  await msal.loginRedirect({
    scopes: LOGIN_SCOPES,
    prompt: 'select_account',
  });
  // loginRedirect navigates away; this code won't continue.
  return null;
}

/**
 * Sign the user out via redirect.
 */
export async function signOut(): Promise<void> {
  const msal = getMsal();
  const account = getAccount();
  if (!account) return;

  clearAccountHint();
  clearCachedUserId();
  clearMsalCacheBackup().catch(() => {});

  await msal.logoutRedirect({
    account,
    postLogoutRedirectUri: REDIRECT_URI,
  });
  // Page navigates away
}

export async function getAccessToken(): Promise<string> {
  const msal = getMsal();
  const account = getAccount();
  if (!account) throw new Error('Not signed in');

  try {
    const result = await msal.acquireTokenSilent({
      scopes: LOGIN_SCOPES,
      account,
    });
    if (!result.accessToken) {
      throw new InteractionRequiredAuthError('empty_token', 'Silent token acquisition returned empty access token');
    }
    // Keep IndexedDB backup fresh after every successful token acquisition
    backupMsalCache().catch(() => {});
    return result.accessToken;
  } catch (err) {
    // In PWA standalone/WCO mode, iframe-based silent renewal often fails
    // with BrowserAuthError (block_iframe_reload, timed_out). Retry using
    // the refresh token (forceRefresh bypasses the iframe approach).
    if (err instanceof BrowserAuthError) {
      console.debug('[Auth] Silent iframe renewal failed, retrying with refresh token:', (err as Error).message);
      try {
        const result = await msal.acquireTokenSilent({
          scopes: LOGIN_SCOPES,
          account,
          forceRefresh: true,
        });
        if (result.accessToken) {
          backupMsalCache().catch(() => {});
          return result.accessToken;
        }
      } catch (retryErr) {
        console.warn('[Auth] Refresh token retry also failed:', retryErr);
        // Fall through to interactive redirect
      }
    }

    if (err instanceof InteractionRequiredAuthError) {
      // Redirect for interactive token — silent refresh failed
      await msal.acquireTokenRedirect({ scopes: LOGIN_SCOPES });
      throw new Error('Redirecting for token…');
    }
    throw err;
  }
}

export function isSignedIn(): boolean {
  return getAccount() !== null;
}

export function getUserDisplayName(): string {
  const account = getAccount();
  return account?.name || account?.username || '';
}

// ─── Graph user ID (for identity-based key derivation) ───

/** Cached Graph `/me` id — matches the extension's userId source exactly. */
let cachedGraphUserId: string | null = null;

/**
 * Get the signed-in user's Graph user ID for identity-based key derivation.
 * Fetches `/me` from Graph on first call and caches the result, ensuring the
 * same ID source as the extension (which stores `profile.id` from Graph `/me`).
 *
 * Previous implementation used MSAL's `localAccountId` (the `oid` claim from
 * the ID token). While these are usually identical for consumer MSA accounts,
 * using the same Graph source as the extension guarantees the HKDF-derived
 * encryption key matches across extension ↔ PWA.
 */
export async function getUserId(): Promise<string | null> {
  const account = getAccount();
  if (!account) return null;

  if (cachedGraphUserId) return cachedGraphUserId;

  try {
    const token = await getAccessToken();
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=id', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn('[Auth] Failed to fetch Graph userId, falling back to localAccountId');
      return account.localAccountId;
    }
    const profile = await res.json();
    cachedGraphUserId = profile.id;
    console.log('[Auth] Graph userId:', cachedGraphUserId!.substring(0, 8) + '…');
    return cachedGraphUserId;
  } catch (err) {
    console.warn('[Auth] Error fetching Graph userId, falling back to localAccountId:', err);
    return account.localAccountId;
  }
}

/**
 * Clear the cached Graph user ID (call on sign-out).
 */
export function clearCachedUserId(): void {
  cachedGraphUserId = null;
}

// ─── Account hint (iOS process-kill recovery) ───

/** Persist a lightweight marker so we know a user was previously signed in. */
function saveAccountHint(account: AccountInfo): void {
  try {
    localStorage.setItem(ACCOUNT_HINT_KEY, JSON.stringify({
      username: account.username,
      name: account.name,
      homeAccountId: account.homeAccountId,
    }));
  } catch { /* localStorage may be unavailable */ }
}

/** Returns true if we previously had a signed-in user. */
function hasAccountHint(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Clear the account hint (on explicit sign-out). */
function clearAccountHint(): void {
  try {
    localStorage.removeItem(ACCOUNT_HINT_KEY);
  } catch { /* */ }
}

/** Read the saved account hint (username + homeAccountId). */
function getAccountHint(): { username: string; homeAccountId: string } | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_HINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── iOS resume recovery ───

/**
 * Attempt to silently recover auth state after an iOS cold restart wiped
 * localStorage. Called from the resume handler in main.ts when `isSignedIn()`
 * returns false but we know the user was previously signed in (account hint
 * was restored from IndexedDB along with the MSAL cache).
 *
 * Strategy:
 * 1. If MSAL has accounts after the IndexedDB restore, try acquireTokenSilent
 *    with forceRefresh (uses refresh token, no iframe).
 * 2. If that fails, try ssoSilent with the saved loginHint — this uses a
 *    hidden iframe and may work if the user has an active Microsoft session.
 * 3. If all else fails, return false and the caller shows the sign-in screen.
 *
 * Returns true if auth was recovered successfully.
 */
export async function tryRecoverAuth(): Promise<boolean> {
  if (!msalInstance) return false;

  // Step 1: check if MSAL found accounts after cache restore
  const account = getAccount();
  if (account) {
    try {
      const result = await msalInstance.acquireTokenSilent({
        scopes: LOGIN_SCOPES,
        account,
        forceRefresh: true,
      });
      if (result.accessToken) {
        console.info('[Auth] iOS recovery: silent token refresh succeeded');
        backupMsalCache().catch(() => {});
        return true;
      }
    } catch (err) {
      console.debug('[Auth] iOS recovery: acquireTokenSilent failed:', (err as Error).message);
    }
  }

  // Step 2: try ssoSilent with login hint from account hint
  const hint = getAccountHint();
  if (hint?.username) {
    try {
      const result = await msalInstance.ssoSilent({
        scopes: LOGIN_SCOPES,
        loginHint: hint.username,
      });
      if (result.account) {
        saveAccountHint(result.account);
        backupMsalCache().catch(() => {});
        console.info('[Auth] iOS recovery: ssoSilent succeeded');
        return true;
      }
    } catch (err) {
      console.debug('[Auth] iOS recovery: ssoSilent failed:', (err as Error).message);
    }
  }

  return false;
}

/**
 * Proactively refresh the access token when the app resumes from background.
 * Called on visibilitychange → visible. Prevents stale-token errors on the
 * first Graph call after resume.
 *
 * Fails silently — if the token can't be refreshed, the next Graph call will
 * handle the error with its own retry/redirect logic.
 */
export async function refreshTokenOnResume(): Promise<void> {
  if (!msalInstance) return;
  const account = getAccount();
  if (!account) return;

  try {
    await msalInstance.acquireTokenSilent({
      scopes: LOGIN_SCOPES,
      account,
      forceRefresh: true,
    });
    backupMsalCache().catch(() => {});
    console.debug('[Auth] Proactive token refresh on resume succeeded');
  } catch {
    // Not critical — the next getAccessToken() call will handle refresh
    console.debug('[Auth] Proactive token refresh on resume skipped/failed');
  }
}
