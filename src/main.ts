import { initAuth, isSignedIn, tryRecoverAuth, refreshTokenOnResume, hasAccountHint } from './services/auth';
import { restoreMsalCacheIfNeeded } from './services/msal-cache-backup';
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
const updateSW = registerSW({
  onNeedRefresh() {
    if (authBootComplete) {
      // Auth already done — safe to activate immediately
      updateSW().catch(() => {});
    } else {
      // Auth still in progress — defer until boot finishes
      pendingSwUpdate = updateSW;
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
        errorDetails = 'Could not connect to Microsoft services. Check your internet connection and try again.';
      }
      // MSAL/auth errors
      else if (errMsg.includes('msal') || errMsg.includes('auth') || errMsg.includes('token')) {
        errorMessage = 'Authentication error';
        errorDetails = 'There was a problem with sign-in. Please reload and try again.';
      }
    }

    // Sanitize error messages before inserting into HTML
    app.innerHTML = `
      <div class="boot-error-screen">
        <p class="boot-error-title">⚠️ ${escapeHtml(errorMessage)}</p>
        ${errorDetails ? `<p class="boot-error-details">${escapeHtml(errorDetails)}</p>` : ''}
        <button class="boot-error-reload" id="bootErrorReload">Reload</button>
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

  // Restore MSAL cache from IndexedDB if iOS wiped localStorage
  const cacheRestored = await restoreMsalCacheIfNeeded();
  if (cacheRestored) {
    console.info('[Boot] MSAL cache restored from IndexedDB backup');
  }

  // initAuth() returns a non-null AuthenticationResult when this page load
  // is the result of a loginRedirect completing. In that case the user is
  // now signed in and we should go straight to the library.
  const redirectResponse = await initAuth();

  // Fix 19: Auth redirect handling is done — safe to activate pending SW update
  authBootComplete = true;
  if (pendingSwUpdate) {
    pendingSwUpdate().catch(() => {});
    pendingSwUpdate = null;
  }

  if (redirectResponse?.account || isSignedIn()) {
    enterApp(app);
  } else if (cacheRestored || hasAccountHint()) {
    // Either IDB had auth data (iOS cache wipe) or localStorage still has an
    // account hint from a previous session but MSAL can't find valid accounts
    // (stale redirect state may have cleared them). Try silent recovery before
    // falling back to the sign-in screen.
    console.debug('[Boot] isSignedIn()=false but account evidence exists (cacheRestored=%s, accountHint=%s) — attempting recovery',
      cacheRestored, hasAccountHint());
    const recovered = await tryRecoverAuth();
    if (recovered && isSignedIn()) {
      console.info('[Boot] Auth recovered without user interaction');
      enterApp(app);
    } else {
      console.debug('[Boot] Recovery failed — showing sign-in');
      renderSignIn(app, () => enterApp(app));
    }
  } else {
    renderSignIn(app, () => enterApp(app));
  }
}

/** Transition to the main app: set up routing, share target, and resume handler. */
function enterApp(app: HTMLElement): void {
  initBroadcast();
  postBroadcast({ type: 'auth-changed', signedIn: true });
  // Load preferences from IndexedDB before rendering (Fix 14)
  initPreferences().then(() => {
    route(app);
  }).catch(() => {
    route(app); // fallback to localStorage-based prefs
  });
  window.addEventListener('hashchange', () => route(app));
  handleShareTarget();
  setupResumeHandler();
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

  // Wait a tick for the library to finish rendering, then open the modal
  requestAnimationFrame(async () => {
    const error = await checkQueuePrereqs();
    if (error) {
      showToast(error, 'error');
      return;
    }
    showAddUrlModal(sharedUrl);
  });
}
