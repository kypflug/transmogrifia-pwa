import { initAuth, signIn, isSignedIn, tryRecoverAuth, refreshTokenOnResume, hasAccountHint, signInWithHint, setupBackgroundBackup } from './services/auth';
import { restoreMsalCacheIfNeeded } from './services/msal-cache-backup';
import { restoreGoogleTokensIfNeeded } from './services/providers/google/token-backup';
import { setProviders, getProviderType } from './services/providers/registry';
import { createMicrosoftAuth } from './services/providers/microsoft/auth';
import { createOneDriveStorage } from './services/providers/microsoft/storage';
import { createGoogleAuth } from './services/providers/google/auth';
import { createGoogleDriveStorage } from './services/providers/google/storage';
import type { AuthProviderType } from './services/providers/types';
import { initBroadcast, postBroadcast } from './services/broadcast';
import { initPreferences } from './services/preferences';
import { renderSignIn } from './screens/sign-in';
import { renderLibrary, showAddUrlModal, teardownScreenListeners } from './screens/library';
import { renderSettings } from './screens/settings';
import { renderSharedViewer } from './screens/shared-viewer';
import { checkQueuePrereqs } from './services/cloud-queue';
import { showToast } from './components/toast';
import { applyTheme } from './theme';
import { escapeHtml } from './utils/storage';
import { registerSW } from 'virtual:pwa-register';

const app = document.getElementById('app')!;

/**
 * Service worker update coordination (Fix 19).
 * With registerType: 'prompt', the new SW waits until we explicitly call
 * updateSW(). We defer activation until after handleRedirectPromise()
 * (initAuth) completes to avoid interrupting auth redirects.
 */
let pendingSwUpdate: (() => Promise<void>) | null = null;
let deferSwUpdate = false;
const updateSW = registerSW({
  onNeedRefresh() {
    if (!authBootComplete || deferSwUpdate) {
      // Auth still in progress or share-target modal open — defer
      pendingSwUpdate = updateSW;
    } else {
      // Safe to activate immediately
      updateSW().catch(() => {});
    }
  },
  onOfflineReady() {
    console.debug('[SW] App ready for offline use');
  },
});
let authBootComplete = false;

boot(app).catch(err => {
    console.error('Boot failed:', err);

    // Provide more helpful error messages based on the error type
    let errorMessage = 'Failed to initialize. Please reload.';
    let errorDetails = '';

    if (err instanceof Error) {
      const errMsg = err.message.toLowerCase();

      // Safari Private Browsing localStorage errors
      if (errMsg.includes('localstorage') || errMsg.includes('quota') || errMsg.includes('storage')) {
        errorMessage = 'Storage access blocked';
        errorDetails = 'This app requires storage access to work. Please disable Private Browsing or use a different browser.';
      }
      // Network/connectivity errors
      else if (errMsg.includes('network') || errMsg.includes('fetch') || errMsg.includes('timeout')) {
        errorMessage = 'Connection failed';
        errorDetails = 'Could not connect to sign-in services. Check your internet connection and try again.';
      }
      // Auth errors
      else if (errMsg.includes('msal') || errMsg.includes('auth') || errMsg.includes('token') || errMsg.includes('oauth')) {
        errorMessage = 'Authentication error';
        errorDetails = 'There was a problem with sign-in. Please reload and try again.';
      }
    }

    // Sanitize error messages before inserting into HTML
    app.innerHTML = `
      <div class="boot-error-screen">
        <div class="boot-titlebar" aria-hidden="true"></div>
        <div class="boot-error-content">
          <p class="boot-error-title">⚠️ ${escapeHtml(errorMessage)}</p>
          ${errorDetails ? `<p class="boot-error-details">${escapeHtml(errorDetails)}</p>` : ''}
          <button class="boot-error-reload" id="bootErrorReload">Reload</button>
        </div>
      </div>
    `;

    // Attach event listener programmatically for CSP compliance
    const reloadBtn = document.getElementById('bootErrorReload');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => window.location.reload());
    }
  });

async function boot(app: HTMLElement): Promise<void> {
  // Apply saved theme immediately
  applyTheme();

  // Shared article viewer — bypass auth entirely
  const sharedMatch = location.pathname.match(/^\/shared\/([A-Za-z0-9]{6,20})$/);
  if (sharedMatch) {
    await renderSharedViewer(app, sharedMatch[1]);
    return;
  }

  // Pre-warm preferences from IndexedDB in parallel with auth initialization.
  const prefsReady = initPreferences().catch(() => {});

  // ─── Provider detection ───
  // Determine which auth+storage provider to use:
  //  1. URL has ?code= → Google OAuth callback (returning from redirect)
  //  2. URL hash has MSAL redirect params → Microsoft redirect callback
  //  3. Persisted provider type → returning user
  //  4. None → new user, show sign-in screen
  const detectedType = detectProviderFromUrl() || getProviderType();

  if (detectedType) {
    initializeProviders(detectedType);

    // Restore cached auth tokens from IndexedDB if iOS wiped localStorage
    let cacheRestored = false;
    if (detectedType === 'microsoft') {
      cacheRestored = await restoreMsalCacheIfNeeded();
      if (cacheRestored) {
        console.info('[Boot] MSAL cache restored from IndexedDB backup');
      }
    } else {
      cacheRestored = await restoreGoogleTokensIfNeeded();
      if (cacheRestored) {
        console.info('[Boot] Google tokens restored from IndexedDB backup');
      }
    }

    // initAuth() processes any pending redirect response (MSAL hash or Google ?code=).
    const redirectResponse = await initAuth();

    // Fix 19: Auth redirect handling is done — safe to activate pending SW update
    authBootComplete = true;
    if (pendingSwUpdate) {
      pendingSwUpdate().catch(() => {});
      pendingSwUpdate = null;
    }

    if (redirectResponse?.account || isSignedIn()) {
      clearAutoRedirectMark();
      await prefsReady;
      enterApp(app);
    } else if (cacheRestored || hasAccountHint()) {
      console.debug('[Boot] isSignedIn()=false but account evidence exists (cacheRestored=%s, accountHint=%s) — attempting recovery',
        cacheRestored, hasAccountHint());
      const recovered = await tryRecoverAuth();
      if (recovered && isSignedIn()) {
        console.info('[Boot] Auth recovered without user interaction');
        clearAutoRedirectMark();
        await prefsReady;
        enterApp(app);
      } else if (canAutoRedirect()) {
        console.info('[Boot] Silent recovery failed — auto-redirecting to login');
        markAutoRedirected();
        await attemptAutoRedirect(app);
      } else {
        console.debug('[Boot] Recovery failed, auto-redirect already attempted — showing sign-in');
        renderSignIn(app, () => enterApp(app), handleProviderSelected(app));
      }
    } else {
      renderSignIn(app, () => enterApp(app), handleProviderSelected(app));
    }
  } else {
    // No provider detected — first visit or signed out. Show sign-in screen.
    authBootComplete = true;
    if (pendingSwUpdate) {
      pendingSwUpdate().catch(() => {});
      pendingSwUpdate = null;
    }
    renderSignIn(app, () => enterApp(app), handleProviderSelected(app));
  }
}

// ─── Provider initialization helpers ───

/** Create and register auth + storage providers for the given type. */
function initializeProviders(type: AuthProviderType): void {
  if (type === 'microsoft') {
    const auth = createMicrosoftAuth();
    const storage = createOneDriveStorage(() => auth.getAccessToken());
    setProviders(auth, storage);
  } else {
    const auth = createGoogleAuth();
    const storage = createGoogleDriveStorage(() => auth.getAccessToken());
    setProviders(auth, storage);
  }
}

/**
 * Detect the provider type from the current URL.
 * - Google OAuth callback: `?code=` in query string
 * - MSAL redirect callback: auth params in hash (code=, id_token=, access_token=, error=)
 * Returns null if URL doesn't indicate a redirect callback.
 */
function detectProviderFromUrl(): AuthProviderType | null {
  const search = window.location.search;
  const hash = window.location.hash;

  // Google OAuth callback — ?code= in query string (with code_verifier in localStorage)
  if (search.includes('code=') && !search.includes('share-target')) {
    return 'google';
  }

  // MSAL redirect callback — auth params in hash
  if (hash.includes('code=') || hash.includes('error=') || hash.includes('id_token=') || hash.includes('access_token=')) {
    return 'microsoft';
  }

  return null;
}

/**
 * Create the onProviderSelected callback for the sign-in screen.
 * When a user clicks a sign-in button, this sets up the provider and initiates sign-in.
 */
function handleProviderSelected(_app: HTMLElement): (type: AuthProviderType) => Promise<void> {
  return async (type: AuthProviderType) => {
    initializeProviders(type);
    await signIn();
    // signIn() redirects away; this code won't continue on regular browsers.
    // On iOS PWA the visibilitychange handler in sign-in.ts handles the return.
  };
}

// ─── Auto-redirect helpers (iOS session recovery) ───

const AUTO_REDIRECT_KEY = 'transmogrifia_auto_redirect';

/** True if we haven't already attempted an auto-redirect this session. */
function canAutoRedirect(): boolean {
  try { return !sessionStorage.getItem(AUTO_REDIRECT_KEY); }
  catch { return false; }
}

function markAutoRedirected(): void {
  try { sessionStorage.setItem(AUTO_REDIRECT_KEY, '1'); }
  catch { /* sessionStorage may be unavailable */ }
}

function clearAutoRedirectMark(): void {
  try { sessionStorage.removeItem(AUTO_REDIRECT_KEY); }
  catch { /* */ }
}

/**
 * Auto-redirect to login with the saved loginHint.
 * Keeps the boot loading spinner visible while the redirect opens.
 *
 * On iOS standalone PWA, loginRedirect opens an in-app Safari sheet rather
 * than navigating the page. A visibilitychange handler re-checks auth when
 * the sheet closes. On regular browsers the page navigates away and boot()
 * runs again on return.
 *
 * Falls back to the manual sign-in screen if the redirect fails.
 */
async function attemptAutoRedirect(app: HTMLElement): Promise<void> {
  // Set up iOS Safari sheet return handler (PWA page stays loaded)
  const handler = async () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', handler);

    try {
      const response = await initAuth(true);
      if (response?.account || isSignedIn()) {
        clearAutoRedirectMark();
        enterApp(app);
        return;
      }
    } catch { /* fall through */ }

    // Auto-redirect didn't result in sign-in — show manual sign-in
    renderSignIn(app, () => enterApp(app), handleProviderSelected(app));
  };
  document.addEventListener('visibilitychange', handler);

  try {
    // loginRedirect navigates away (or opens iOS Safari sheet)
    await signInWithHint();
  } catch {
    document.removeEventListener('visibilitychange', handler);
    renderSignIn(app, () => enterApp(app), handleProviderSelected(app));
  }
}

/** Transition to the main app: set up routing, share target, and resume handler. */
function enterApp(app: HTMLElement): void {
  initBroadcast();
  postBroadcast({ type: 'auth-changed', signedIn: true });
  route(app);
  window.addEventListener('hashchange', () => route(app));
  handleShareTarget();
  setupResumeHandler();
  setupBackgroundBackup();
}

function route(app: HTMLElement): void {
  // Tear down library listeners/coordinator before switching screens (Fix 20)
  teardownScreenListeners();
  const hash = location.hash.slice(1);
  if (hash === 'settings') {
    renderSettings(app);
  } else {
    renderLibrary(app);
  }
}

/**
 * Proactively refresh the access token when the app resumes from background.
 *
 * On iOS, WKWebView processes are suspended aggressively. If the access token
 * expired while backgrounded, the first Graph call after resume would fail and
 * trigger a redirect to Microsoft login — which looks like being signed out.
 *
 * Strategy (Fix 12):
 * 1. Try non-forced acquireTokenSilent (cheap — uses cached token if still valid)
 * 2. Only escalate to forceRefresh: true if the cheap attempt fails
 * 3. Hard floor of 30 seconds between any refresh attempts to avoid hammering
 */
function setupResumeHandler(): void {
  let lastRefresh = Date.now();
  const REFRESH_FLOOR_MS = 30_000; // 30 seconds

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    const now = Date.now();
    if (now - lastRefresh < REFRESH_FLOOR_MS) return;
    lastRefresh = now;

    // First try a cheap silent acquire (uses cached token if still valid)
    refreshTokenOnResume().catch(() => {
      // Non-critical — token refresh will happen on next Graph call
      console.debug('[Auth] Resume token refresh failed — next Graph call will handle it');
    });
  });
}

/**
 * Handle incoming Share Target intents.
 *
 * When the PWA is invoked via the OS share sheet the browser navigates to
 * `/?share-target&url=…&title=…&text=…`. We extract the shared URL, clean
 * the address bar, and auto-open the Add URL modal pre-filled.
 */
function handleShareTarget(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('share-target')) return;

  // Extract the URL — may be in `url` param directly, or embedded in `text`
  let sharedUrl = params.get('url') || '';
  if (!sharedUrl) {
    // Some apps put the URL in `text` instead
    const text = params.get('text') || '';
    const urlMatch = text.match(/https?:\/\/\S+/);
    if (urlMatch) sharedUrl = urlMatch[0];
  }

  // Clean the URL so reloads don't re-trigger
  history.replaceState(null, '', '/');

  if (!sharedUrl) return;

  // Defer SW auto-update while the share modal is open to prevent reload
  deferSwUpdate = true;

  // Wait a tick for the library to finish rendering, then open the modal
  requestAnimationFrame(async () => {
    const error = await checkQueuePrereqs();
    if (error) {
      showToast(error, 'error');
      deferSwUpdate = false;
      if (pendingSwUpdate) { pendingSwUpdate().catch(() => {}); pendingSwUpdate = null; }
      return;
    }
    showAddUrlModal(sharedUrl, () => {
      deferSwUpdate = false;
      if (pendingSwUpdate) { pendingSwUpdate().catch(() => {}); pendingSwUpdate = null; }
    });
  });
}
