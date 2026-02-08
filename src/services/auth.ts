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

export async function initAuth(): Promise<PublicClientApplication> {
  if (msalInstance) return msalInstance;
  msalInstance = new PublicClientApplication(msalConfig);
  await msalInstance.initialize();

  // Handle redirect promise (for loginRedirect flow)
  // On Safari/iOS, this can throw errors if there's a stale redirect state,
  // localStorage issues, or cookie restrictions. We catch and log the error
  // but allow initialization to continue so the app can still load.
  try {
    await msalInstance.handleRedirectPromise();
  } catch (err) {
    console.warn('handleRedirectPromise failed (non-fatal):', err);
    // If this fails, the user might need to sign in again, but the app should still load
  }

  return msalInstance;
}

export function getAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}

export async function signIn(): Promise<AccountInfo> {
  const msal = await initAuth();
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
  if (account) {
    await msal.logoutPopup({ account });
  }
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
      try {
        const result = await msal.acquireTokenPopup({
          scopes: LOGIN_SCOPES,
        });
        if (!result.accessToken) {
          throw new Error('Token acquisition returned empty access token');
        }
        return result.accessToken;
      } catch {
        // Popup blocked (e.g. Safari/iOS) — fall back to redirect
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
