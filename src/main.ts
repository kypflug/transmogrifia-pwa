import { initAuth, isSignedIn } from './services/auth';
import { renderSignIn } from './screens/sign-in';
import { renderLibrary } from './screens/library';
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
    renderLibrary(app);
  } else {
    renderSignIn(app, () => renderLibrary(app));
  }
}
