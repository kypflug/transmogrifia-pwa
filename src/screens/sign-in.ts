import { signIn } from '../services/auth';

export function renderSignIn(
  container: HTMLElement,
  onSuccess: () => void,
): void {
  container.innerHTML = `
    <div class="sign-in-screen">
      <div class="sign-in-card">
        <div class="sign-in-brand">
          <span class="brand-icon">📦</span>
          <h1>Library of<br>Transmogrifia</h1>
        </div>
        <p class="sign-in-tagline">Your transmogrified articles, anywhere.</p>
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
          Requires the <strong>Transmogrifier</strong> extension for article creation.
        </p>
      </div>
    </div>
  `;

  container.querySelector('#signInBtn')!.addEventListener('click', async () => {
    const btn = container.querySelector('#signInBtn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signIn();
      onSuccess();
    } catch (err) {
      console.error('Sign-in failed:', err);
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
  });
}
