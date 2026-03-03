import { signIn, isSignedIn, initAuth } from '../services/auth';
import type { AuthProviderType } from '../services/providers/types';

export function renderSignIn(
  container: HTMLElement,
  onSuccess: () => void,
  onProviderSelected?: (type: AuthProviderType) => Promise<void>,
): void {
  let signInInitiated = false;
  let resolved = false;

  container.innerHTML = `
    <div class="sign-in-screen">
      <div class="sign-in-titlebar"></div>
      <div class="sign-in-hero">
        <picture>
          <source srcset="/images/hero.avif" type="image/avif">
          <source srcset="/images/hero.webp" type="image/webp">
          <img src="/images/hero.jpg" alt="Watercolor illustration of the Library of Alexandria" class="sign-in-hero-img" loading="eager">
        </picture>
        <div class="sign-in-hero-overlay"></div>
      </div>
      <div class="sign-in-card">
        <div class="sign-in-brand">
          <img src="/icons/icon-64.png" alt="" class="brand-icon-img" width="56" height="56">
          <h1>Library of<br>Transmogrifia</h1>
        </div>
        <p class="sign-in-tagline">Remix the web. Read it anywhere. Share with a friend.</p>
        <button class="sign-in-btn" id="signInBtn">
          <svg width="20" height="20" viewBox="0 0 21 21">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          Sign in with Microsoft
        </button>
        <div class="sign-in-divider">
          <span>or</span>
        </div>
        <button class="sign-in-btn sign-in-btn-google" id="signInGoogleBtn">
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign in with Google
        </button>
        <p class="sign-in-footnote">
          Sign in to remix any URL, or use the <strong>Transmogrifier</strong> extension to remix from a desktop browser.
        </p>
      </div>
    </div>
  `;

  /** Show the "Signing in…" state on both buttons. */
  function showSigningIn(): void {
    const msBtn = container.querySelector('#signInBtn') as HTMLButtonElement | null;
    const googleBtn = container.querySelector('#signInGoogleBtn') as HTMLButtonElement | null;
    if (msBtn) {
      msBtn.disabled = true;
      msBtn.textContent = 'Signing in…';
    }
    if (googleBtn) {
      googleBtn.disabled = true;
      googleBtn.textContent = 'Signing in…';
    }
  }

  /** Restore both buttons to their default state. */
  function resetButton(): void {
    const msBtn = container.querySelector('#signInBtn') as HTMLButtonElement | null;
    if (msBtn) {
      msBtn.disabled = false;
      msBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 21 21">
          <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
          <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
        </svg>
        Sign in with Microsoft`;
    }
    const googleBtn = container.querySelector('#signInGoogleBtn') as HTMLButtonElement | null;
    if (googleBtn) {
      googleBtn.disabled = false;
      googleBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        Sign in with Google`;
    }
  }

  /** Transition to the library if we're signed in. Only runs once. */
  function tryResolve(): void {
    if (resolved) return;
    if (isSignedIn()) {
      resolved = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      onSuccess();
    }
  }

  /**
   * iOS standalone PWA handler: when loginRedirect opens an in-app Safari
   * sheet, the PWA doesn't navigate — it just loses and regains visibility.
   * On return, MSAL may have cached the account/tokens in localStorage.
   * We re-initialise MSAL to process any redirect response, then check
   * if we're now signed in.
   */
  async function onVisibilityChange(): Promise<void> {
    if (document.visibilityState !== 'visible' || !signInInitiated || resolved) return;

    showSigningIn();

    try {
      // Re-process any pending redirect response that MSAL cached
      const response = await initAuth(true);
      if (response?.account) {
        tryResolve();
        return;
      }
    } catch {
      // initAuth may fail — fall through to account check
    }

    // Even if handleRedirectPromise didn't return a result,
    // MSAL may have cached the account from the redirect
    if (isSignedIn()) {
      tryResolve();
    } else {
      // Not signed in yet — reset the button
      resetButton();
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  container.querySelector('#signInBtn')!.addEventListener('click', async () => {
    signInInitiated = true;
    showSigningIn();
    try {
      if (onProviderSelected) {
        await onProviderSelected('microsoft');
      } else {
        const account = await signIn();
        // signIn() returns null when it triggers a redirect.
        // On a normal browser the page navigates away.
        // On iOS PWA the page stays — visibilitychange handles the return.
        if (account) {
          tryResolve();
        }
      }
    } catch (err) {
      console.error('Sign-in failed:', err);
      signInInitiated = false;
      resetButton();
    }
  });

  container.querySelector('#signInGoogleBtn')!.addEventListener('click', async () => {
    signInInitiated = true;
    showSigningIn();
    try {
      if (onProviderSelected) {
        await onProviderSelected('google');
      }
    } catch (err) {
      console.error('Sign-in failed:', err);
      signInInitiated = false;
      resetButton();
    }
  });
}
