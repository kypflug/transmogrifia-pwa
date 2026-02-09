import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';

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
    return response;
  } catch (err) {
    console.warn('handleRedirectPromise failed (non-fatal):', err);
    // Clear any stale interaction state that could block future sign-in attempts
    cleanUpStaleState();
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
  return accounts.length > 0 ? accounts[0] : null;
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
    return result.accessToken;
  } catch (err) {
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
