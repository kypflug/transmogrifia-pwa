/**
 * Touch gesture handling for article navigation.
 *
 * - Horizontal swipe right → back to article list (mobile only)
 * - Overscroll up at top of article → previous article (all viewports)
 * - Overscroll down at bottom of article → next article (all viewports)
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
 * Safely get the iframe's Document, trying both contentDocument and
 * contentWindow.document. Returns null if inaccessible (cross-origin
 * or document not yet loaded).
 */
function getIframeDocument(frame: HTMLIFrameElement): Document | null {
  try {
    const doc = frame.contentDocument ?? frame.contentWindow?.document ?? null;
    if (!doc || !doc.body) return null;
    return doc;
  } catch {
    return null;
  }
}

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

  const narrowQuery = window.matchMedia('(max-width: 767px)');

  function onTouchStart(e: TouchEvent) {
    // Back swipe only applies in narrow (single-pane) mode;
    // checked at swipe time so resizing the viewport takes effect immediately.
    if (!narrowQuery.matches) return;

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

  // Attach to iframe documentElement — more reliable than Document on iOS Safari
  const iframeDoc = getIframeDocument(frame);
  if (iframeDoc) {
    cleanupFns.push(attachTouchListeners(iframeDoc.documentElement, handlers, false));
  }
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
  // Scroll state captured at touchstart — do NOT re-check during move,
  // because the browser's native scroll will shift scrollTop immediately.
  let wasAtTop = false;
  let wasAtBottom = false;
  let decided = false;

  function getScrollInfo(): { atTop: boolean; atBottom: boolean } {
    try {
      const doc = frame.contentDocument;
      if (!doc) return { atTop: false, atBottom: false };

      // In srcdoc iframes, which element actually scrolls varies by browser.
      // Check documentElement and body; pick the one with real overflow.
      const html = doc.documentElement;
      const body = doc.body;
      if (!html) return { atTop: false, atBottom: false };

      // Find the element whose scrollHeight exceeds its clientHeight
      let scrollTop = 0;
      let scrollHeight = 0;
      let clientHeight = 0;

      if (html.scrollHeight > html.clientHeight + 1) {
        scrollTop = html.scrollTop;
        scrollHeight = html.scrollHeight;
        clientHeight = html.clientHeight;
      } else if (body && body.scrollHeight > body.clientHeight + 1) {
        scrollTop = body.scrollTop;
        scrollHeight = body.scrollHeight;
        clientHeight = body.clientHeight;
      } else {
        // Content fits without scrolling — no overscroll nav
        return { atTop: false, atBottom: false };
      }

      return {
        atTop: scrollTop <= 1,
        atBottom: scrollTop + clientHeight >= scrollHeight - 1,
      };
    } catch {
      return { atTop: false, atBottom: false };
    }
  }

  function onTouchStart(e: TouchEvent) {
    const info = getScrollInfo();
    wasAtTop = info.atTop;
    wasAtBottom = info.atBottom;

    if (!wasAtTop && !wasAtBottom) return;

    tracking = true;
    decided = false;
    didTrigger = false;
    startY = e.touches[0].clientY;
    direction = null;
    overscroll = 0;
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return;
    const dy = e.touches[0].clientY - startY;

    // Decide direction once after a small movement threshold
    if (!decided && Math.abs(dy) > 10) {
      decided = true;
      if (dy > 0 && wasAtTop) {
        direction = 'prev';
      } else if (dy < 0 && wasAtBottom) {
        direction = 'next';
      } else {
        // User is scrolling in the normal direction — stop tracking
        tracking = false;
        return;
      }
      ensureOverscrollIndicator();
    }

    if (!decided || !direction) return;

    overscroll = Math.abs(dy);
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

  // Attach to iframe documentElement only — overscroll nav should only trigger
  // from within the article content, not the header bar.
  // Using documentElement (not Document) for reliable iOS Safari event dispatch.
  const iframeDoc = getIframeDocument(frame);
  if (iframeDoc) {
    cleanupFns.push(attachTouchListeners(iframeDoc.documentElement, handlers));
  }
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
