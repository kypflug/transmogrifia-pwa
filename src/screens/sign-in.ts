import { signIn, isSignedIn, initAuth } from '../services/auth';

export function renderSignIn(
  container: HTMLElement,
  onSuccess: () => void,
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
        <p class="sign-in-footnote">
          Sign in to remix any URL, or use the <strong>Transmogrifier</strong> extension to remix from a desktop browser.
        </p>
      </div>
    </div>
  `;

  /** Show the "Signing in…" state on the button. */
  function showSigningIn(): void {
    const btn = container.querySelector('#signInBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing in…';
    }
  }

  /** Restore the button to its default state. */
  function resetButton(): void {
    const btn = container.querySelector('#signInBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 21 21">
          <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
          <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
        </svg>
        Sign in with Microsoft`;
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
      const account = await signIn();
      // signIn() returns null when it triggers a redirect.
      // On a normal browser the page navigates away.
      // On iOS PWA the page stays — visibilitychange handles the return.
      if (account) {
        tryResolve();
      }
    } catch (err) {
      console.error('Sign-in failed:', err);
      signInInitiated = false;
      resetButton();
    }
  });
}
