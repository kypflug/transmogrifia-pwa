/**
 * Touch gesture handling for mobile article navigation.
 *
 * - Horizontal swipe right → back to article list
 * - Overscroll up at top of article → previous article
 * - Overscroll down at bottom of article → next article
 *
 * Gestures are attached to both the reading pane (for the header bar) and
 * the iframe's contentDocument (for the article body), since touch events
 * inside an iframe don't bubble to the parent.
 */

const BACK_THRESHOLD = 100;      // px horizontal distance to trigger back
const OVERSCROLL_THRESHOLD = 80; // px vertical overscroll to trigger nav
const INDICATOR_MAX = 120;       // max indicator travel in px

type BackCallback = () => void;
type NavCallback = (direction: 'prev' | 'next') => void;

let backIndicator: HTMLElement | null = null;
let overscrollIndicator: HTMLElement | null = null;
let cleanupFns: Array<() => void> = [];

/**
 * Attach touch listeners to an EventTarget (HTMLElement or Document).
 * Returns a cleanup function.
 */
function attachTouchListeners(
  target: EventTarget,
  handlers: {
    onStart: (e: TouchEvent) => void;
    onMove: (e: TouchEvent) => void;
    onEnd: () => void;
  },
  movePassive: boolean = true,
): () => void {
  target.addEventListener('touchstart', handlers.onStart as EventListener, { passive: true });
  target.addEventListener('touchmove', handlers.onMove as EventListener, { passive: movePassive });
  target.addEventListener('touchend', handlers.onEnd as EventListener, { passive: true });
  target.addEventListener('touchcancel', handlers.onEnd as EventListener, { passive: true });

  return () => {
    target.removeEventListener('touchstart', handlers.onStart as EventListener);
    target.removeEventListener('touchmove', handlers.onMove as EventListener);
    target.removeEventListener('touchend', handlers.onEnd as EventListener);
    target.removeEventListener('touchcancel', handlers.onEnd as EventListener);
  };
}

// ── Back swipe (horizontal right swipe) ─────────────────────────────────────

export function initBackSwipe(
  pane: HTMLElement,
  frame: HTMLIFrameElement,
  onBack: BackCallback,
): void {
  let tracking = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let didTrigger = false;
  let decided = false;

  function onTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    tracking = true;
    decided = false;
    didTrigger = false;
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = 0;
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = Math.abs(touch.clientY - startY);

    // Decide once: is this a horizontal or vertical gesture?
    if (!decided && (Math.abs(dx) > 10 || dy > 10)) {
      decided = true;
      if (dy > Math.abs(dx)) {
        // Vertical — not a back swipe
        tracking = false;
        hideBackIndicator();
        return;
      }
      ensureBackIndicator();
    }

    if (!decided) return;

    if (dx <= 0) {
      hideBackIndicator();
      return;
    }

    currentX = dx;
    // Only preventDefault if we own the gesture — in the parent pane we can,
    // in the iframe doc we also can to stop its scrolling.
    try { e.preventDefault(); } catch { /* passive listener in iframe */ }

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

  const handlers = { onStart: onTouchStart, onMove: onTouchMove, onEnd: onTouchEnd };

  // Attach to the pane (header bar area)
  cleanupFns.push(attachTouchListeners(pane, handlers, false));

  // Attach to iframe contentDocument
  try {
    const doc = frame.contentDocument;
    if (doc) {
      cleanupFns.push(attachTouchListeners(doc, handlers, false));
    }
  } catch { /* cross-origin */ }
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

  const handlers = { onStart: onTouchStart, onMove: onTouchMove, onEnd: onTouchEnd };

  // Attach to iframe contentDocument directly
  try {
    const doc = frame.contentDocument;
    if (doc) {
      cleanupFns.push(attachTouchListeners(doc, handlers));
    }
  } catch { /* cross-origin */ }

  // Also attach to the pane (header bar)
  const pane = (frame.closest('.reading-pane') || frame.parentElement!) as HTMLElement;
  cleanupFns.push(attachTouchListeners(pane, handlers));
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
