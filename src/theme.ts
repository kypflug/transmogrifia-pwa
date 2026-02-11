import type { Theme } from './types';
import { getTheme, setTheme as saveTheme } from './services/preferences';

/**
 * Apply the current theme (from preferences or system default).
 */
export function applyTheme(theme?: Theme): void {
  const t = theme ?? getTheme();
  const resolved =
    t === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : t;

  document.documentElement.setAttribute('data-theme', resolved);

  if (theme) saveTheme(theme);

  // Update meta theme-color to match surface-raised (used by sidebar/article/settings headers)
  const colors: Record<string, string> = {
    light: '#FFFFFF',
    dark: '#2B2B30',
    sepia: '#FBF6EB',
  };
  const metaEl = document.querySelector('meta[name="theme-color"]');
  if (metaEl) {
    metaEl.setAttribute('content', colors[resolved] || colors.light);
  }
}

// Listen for system theme changes when set to 'system'
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme();
});
