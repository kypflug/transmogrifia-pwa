import { initAuth, isSignedIn } from './services/auth';
import { renderSignIn } from './screens/sign-in';
import { renderLibrary, showAddUrlModal } from './screens/library';
import { renderSettings } from './screens/settings';
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

  // initAuth() returns a non-null AuthenticationResult when this page load
  // is the result of a loginRedirect completing. In that case the user is
  // now signed in and we should go straight to the library.
  const redirectResponse = await initAuth();

  if (redirectResponse?.account || isSignedIn()) {
    route(app);
    window.addEventListener('hashchange', () => route(app));
    handleShareTarget();
  } else {
    renderSignIn(app, () => {
      route(app);
      window.addEventListener('hashchange', () => route(app));
    });
  }
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
