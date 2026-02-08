/**
 * Touch gesture handling for mobile article navigation.
 *
 * - Left-edge swipe right → back to article list
 * - Overscroll up at top of article → previous article
 * - Overscroll down at bottom of article → next article
 */

const EDGE_ZONE = 24;            // px from left edge to start a back swipe
const BACK_THRESHOLD = 100;      // px horizontal distance to trigger back
const OVERSCROLL_THRESHOLD = 80; // px vertical overscroll to trigger nav
const INDICATOR_MAX = 120;       // max indicator travel in px

type BackCallback = () => void;
type NavCallback = (direction: 'prev' | 'next') => void;

let backIndicator: HTMLElement | null = null;
let overscrollIndicator: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];

// ── Back swipe (left edge → right) ──────────────────────────────────────────

export function initBackSwipe(
  target: HTMLElement,
  onBack: BackCallback,
): void {
  let tracking = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let didTrigger = false;

  function onTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    // Only start if touch begins near the left edge
    if (touch.clientX > EDGE_ZONE) return;
    tracking = true;
    didTrigger = false;
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = 0;
    ensureBackIndicator();
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = Math.abs(touch.clientY - startY);

    // Cancel if swiping more vertically than horizontally
    if (dy > Math.abs(dx) * 1.5 && dx < 30) {
      tracking = false;
      hideBackIndicator();
      return;
    }

    if (dx < 0) {
      // Swiping left — ignore
      hideBackIndicator();
      return;
    }

    currentX = dx;
    e.preventDefault(); // Prevent scrolling while swiping back

    const progress = Math.min(dx / BACK_THRESHOLD, 1);
    updateBackIndicator(progress);
  }

  function onTouchEnd() {
    if (!tracking) return;
    tracking = false;

    if (currentX >= BACK_THRESHOLD && !didTrigger) {
      didTrigger = true;
      onBack();
    }

    hideBackIndicator();
  }

  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: false });
  target.addEventListener('touchend', onTouchEnd, { passive: true });
  target.addEventListener('touchcancel', onTouchEnd, { passive: true });

  cleanupFns.push(() => {
    target.removeEventListener('touchstart', onTouchStart);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('touchend', onTouchEnd);
    target.removeEventListener('touchcancel', onTouchEnd);
  });
}

// ── Overscroll prev/next ────────────────────────────────────────────────────

export function initOverscrollNav(
  frame: HTMLIFrameElement,
  onNav: NavCallback,
): void {
  let tracking = false;
  let startY = 0;
  let direction: 'prev' | 'next' | null = null;
  let overscroll = 0;
  let didTrigger = false;

  // We listen on the iframe's contentDocument for scroll position,
  // but on the reading pane for touch events (since iframe content may not
  // propagate touch events to the parent).
  const pane = (frame.closest('.reading-pane') || frame.parentElement!) as HTMLElement;

  function getScrollInfo(): { atTop: boolean; atBottom: boolean } {
    try {
      const doc = frame.contentDocument;
      if (!doc || !doc.documentElement) return { atTop: true, atBottom: true };
      const el = doc.documentElement;
      const scrollTop = el.scrollTop || doc.body?.scrollTop || 0;
      const scrollHeight = el.scrollHeight || doc.body?.scrollHeight || 0;
      const clientHeight = el.clientHeight || doc.body?.clientHeight || 0;
      return {
        atTop: scrollTop <= 1,
        atBottom: scrollTop + clientHeight >= scrollHeight - 1,
      };
    } catch {
      return { atTop: false, atBottom: false };
    }
  }

  function onTouchStart(e: TouchEvent) {
    const { atTop, atBottom } = getScrollInfo();
    if (!atTop && !atBottom) return;

    tracking = true;
    didTrigger = false;
    startY = e.touches[0].clientY;
    direction = null;
    overscroll = 0;
    ensureOverscrollIndicator();
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return;
    const dy = e.touches[0].clientY - startY;
    const { atTop, atBottom } = getScrollInfo();

    // Determine direction
    if (dy > 10 && atTop) {
      direction = 'prev';
      overscroll = dy;
    } else if (dy < -10 && atBottom) {
      direction = 'next';
      overscroll = Math.abs(dy);
    } else {
      direction = null;
      overscroll = 0;
      hideOverscrollIndicator();
      return;
    }

    const progress = Math.min(overscroll / OVERSCROLL_THRESHOLD, 1);
    updateOverscrollIndicator(direction, progress);
  }

  function onTouchEnd() {
    if (!tracking) return;
    tracking = false;

    if (direction && overscroll >= OVERSCROLL_THRESHOLD && !didTrigger) {
      didTrigger = true;
      onNav(direction);
    }

    hideOverscrollIndicator();
  }

  pane.addEventListener('touchstart', onTouchStart, { passive: true });
  pane.addEventListener('touchmove', onTouchMove, { passive: true });
  pane.addEventListener('touchend', onTouchEnd, { passive: true });
  pane.addEventListener('touchcancel', onTouchEnd, { passive: true });

  cleanupFns.push(() => {
    pane.removeEventListener('touchstart', onTouchStart);
    pane.removeEventListener('touchmove', onTouchMove);
    pane.removeEventListener('touchend', onTouchEnd);
    pane.removeEventListener('touchcancel', onTouchEnd);
  });
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function destroyGestures(): void {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
  backIndicator?.remove();
  backIndicator = null;
  overscrollIndicator?.remove();
  overscrollIndicator = null;
}

// ── Visual indicators ───────────────────────────────────────────────────────

function ensureBackIndicator(): void {
  if (backIndicator) return;
  backIndicator = document.createElement('div');
  backIndicator.className = 'gesture-back-indicator';
  backIndicator.innerHTML = '<span class="gesture-back-arrow">‹</span>';
  document.body.appendChild(backIndicator);
}

function updateBackIndicator(progress: number): void {
  if (!backIndicator) return;
  const travel = progress * INDICATOR_MAX;
  backIndicator.style.transform = `translateX(${travel}px) scale(${0.6 + progress * 0.4})`;
  backIndicator.style.opacity = String(Math.min(progress * 1.5, 1));
  backIndicator.classList.toggle('ready', progress >= 1);
}

function hideBackIndicator(): void {
  if (!backIndicator) return;
  backIndicator.style.transform = 'translateX(0) scale(0.4)';
  backIndicator.style.opacity = '0';
  backIndicator.classList.remove('ready');
}

function ensureOverscrollIndicator(): void {
  if (overscrollIndicator) return;
  overscrollIndicator = document.createElement('div');
  overscrollIndicator.className = 'gesture-overscroll-indicator';
  overscrollIndicator.innerHTML = '<span class="gesture-overscroll-arrow">›</span>';
  document.body.appendChild(overscrollIndicator);
}

function updateOverscrollIndicator(dir: 'prev' | 'next', progress: number): void {
  if (!overscrollIndicator) return;
  const arrow = overscrollIndicator.querySelector('.gesture-overscroll-arrow') as HTMLElement;

  if (dir === 'prev') {
    overscrollIndicator.style.top = '0';
    overscrollIndicator.style.bottom = '';
    arrow.style.transform = `rotate(-90deg)`;
    const travel = progress * 40;
    overscrollIndicator.style.transform = `translateY(${travel}px)`;
  } else {
    overscrollIndicator.style.top = '';
    overscrollIndicator.style.bottom = '0';
    arrow.style.transform = `rotate(90deg)`;
    const travel = progress * 40;
    overscrollIndicator.style.transform = `translateY(-${travel}px)`;
  }

  overscrollIndicator.style.opacity = String(Math.min(progress * 1.5, 1));
  overscrollIndicator.classList.toggle('ready', progress >= 1);
}

function hideOverscrollIndicator(): void {
  if (!overscrollIndicator) return;
  overscrollIndicator.style.transform = 'translateY(0)';
  overscrollIndicator.style.opacity = '0';
  overscrollIndicator.classList.remove('ready');
}
