import { initAuth, isSignedIn, tryRecoverAuth, refreshTokenOnResume } from './services/auth';
import { restoreMsalCacheIfNeeded } from './services/msal-cache-backup';
import { renderSignIn } from './screens/sign-in';
import { renderLibrary, showAddUrlModal } from './screens/library';
import { renderSettings } from './screens/settings';
import { renderSharedViewer } from './screens/shared-viewer';
import { checkQueuePrereqs } from './services/cloud-queue';
import { showToast } from './components/toast';
import { applyTheme } from './theme';
import { escapeHtml } from './utils/storage';

const app = document.getElementById('app')!;

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

  if (redirectResponse?.account || isSignedIn()) {
    enterApp(app);
  } else if (cacheRestored) {
    // IndexedDB had auth data but MSAL didn't find valid accounts — try
    // silent recovery (refresh token or SSO session) before giving up.
    const recovered = await tryRecoverAuth();
    if (recovered && isSignedIn()) {
      console.info('[Boot] iOS recovery: auth restored without user interaction');
      enterApp(app);
    } else {
      renderSignIn(app, () => enterApp(app));
    }
  } else {
    renderSignIn(app, () => enterApp(app));
  }
}

/** Transition to the main app: set up routing, share target, and resume handler. */
function enterApp(app: HTMLElement): void {
  route(app);
  window.addEventListener('hashchange', () => route(app));
  handleShareTarget();
  setupResumeHandler();
}

function route(app: HTMLElement): void {
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
 * By refreshing early (on visibilitychange → visible), we ensure the token is
 * fresh before any UI-initiated Graph call.
 */
function setupResumeHandler(): void {
  let lastRefresh = Date.now();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    // Throttle: don't refresh more than once per 2 minutes
    const now = Date.now();
    if (now - lastRefresh < 120_000) return;
    lastRefresh = now;

    refreshTokenOnResume().catch(() => {
      // Non-critical — token refresh will happen on next Graph call
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
