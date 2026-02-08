import { initAuth, isSignedIn } from './services/auth';
import { renderSignIn } from './screens/sign-in';
import { renderLibrary } from './screens/library';
import { applyTheme } from './theme';

const app = document.getElementById('app')!;

async function boot(): Promise<void> {
  // Apply saved theme immediately
  applyTheme();

  await initAuth();

  if (isSignedIn()) {
    renderLibrary(app);
  } else {
    renderSignIn(app, () => renderLibrary(app));
  }
}

boot().catch(err => {
  console.error('Boot failed:', err);
  app.innerHTML = '<p class="boot-error">Failed to initialize. Please reload.</p>';
});
