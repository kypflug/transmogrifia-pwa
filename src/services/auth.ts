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

/**
 * Detect iOS (iPhone, iPad, iPod) — all iOS browsers use WebKit and
 * have the same popup/cross-tab limitations as Safari.
 * iPadOS 13+ reports "MacIntel" but has touch support.
 */
function useRedirectFlow(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS;
}

/** Resolves once MSAL has been initialized and any redirect response handled. */
let redirectAccountPromise: Promise<AccountInfo | null> | null = null;

export async function initAuth(): Promise<PublicClientApplication> {
  if (msalInstance) return msalInstance;
  msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  // Handle redirect promise (for loginRedirect / acquireTokenRedirect flow).
  // Cache the promise so callers can await the redirect account result.
  // On Safari/iOS, this can throw errors if there's a stale redirect state,
  // localStorage issues, or cookie restrictions. We catch and log the error
  // but allow initialization to continue so the app can still load.
  try {
    redirectAccountPromise = msalInstance.handleRedirectPromise().then(
      (result: AuthenticationResult | null) => result?.account ?? null,
    );
    await redirectAccountPromise;
  } catch (err) {
    console.warn('handleRedirectPromise failed (non-fatal):', err);
    redirectAccountPromise = Promise.resolve(null);
  }

  return msalInstance;
}

/**
 * If the current page load is a redirect return from a login flow,
 * returns the newly-signed-in account. Otherwise returns null.
 */
export async function getRedirectAccount(): Promise<AccountInfo | null> {
  return redirectAccountPromise ?? null;
}

export function getAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}

export async function signIn(): Promise<AccountInfo> {
  const msal = await initAuth();

  // On iOS, popup-based auth is unreliable (opens a new tab and cross-tab
  // communication is blocked by ITP). Use redirect flow instead.
  if (useRedirectFlow()) {
    await msal.loginRedirect({
      scopes: LOGIN_SCOPES,
      prompt: 'select_account',
    });
    // Page will navigate away; this throw prevents further execution.
    throw new Error('Redirecting for login…');
  }

  try {
    const result: AuthenticationResult = await msal.loginPopup({
      scopes: LOGIN_SCOPES,
      prompt: 'select_account',
    });
    return result.account!;
  } catch {
    // Fallback to redirect if popup is blocked
    await msal.loginRedirect({ scopes: LOGIN_SCOPES });
    throw new Error('Redirecting for login…');
  }
}

export async function signOut(): Promise<void> {
  const msal = await initAuth();
  const account = getAccount();
  if (!account) return;

  if (useRedirectFlow()) {
    await msal.logoutRedirect({ account });
    return;
  }

  await msal.logoutPopup({ account });
}

export async function getAccessToken(): Promise<string> {
  const msal = await initAuth();
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
      // On iOS, skip popup and go straight to redirect
      if (useRedirectFlow()) {
        await msal.acquireTokenRedirect({ scopes: LOGIN_SCOPES });
        throw new Error('Redirecting for token…');
      }

      try {
        const result = await msal.acquireTokenPopup({
          scopes: LOGIN_SCOPES,
        });
        if (!result.accessToken) {
          throw new Error('Token acquisition returned empty access token');
        }
        return result.accessToken;
      } catch {
        // Popup blocked — fall back to redirect
        await msal.acquireTokenRedirect({ scopes: LOGIN_SCOPES });
        throw new Error('Redirecting for token…');
      }
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
