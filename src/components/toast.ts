const TOAST_DURATION = 3000;

let activeToast: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a toast notification.
 */
export function showToast(message: string, type: 'info' | 'error' = 'info'): void {
  // Remove existing toast
  if (activeToast) {
    activeToast.remove();
    if (hideTimeout) clearTimeout(hideTimeout);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('visible'));

  activeToast = toast;
  hideTimeout = setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    activeToast = null;
  }, TOAST_DURATION);
}
