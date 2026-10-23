// Page-view beacon for the insight dashboard: one event per visit, sent when the visitor leaves.
// No cookie or identifier; the Worker keeps only the referrer host and search-engine words.
import { sendEvent } from '../widget/api.js';

const STEPS = [100, 75, 50, 25];
const MAX_PATH_CHARS = 200;

/**
 * Deepest 25% step of the post body that has scrolled into view.
 * @param {{ top: number, height: number }} body position on the page (px)
 * @param {number} viewportBottom page px at the bottom of the viewport
 */
export function depthReached({ top, height }, viewportBottom) {
  if (height <= 0) return 0;
  const seen = (viewportBottom - top) / height;
  return STEPS.find((step) => seen >= step / 100) ?? 0;
}

/**
 * @param {{ apiBase: string, postId: number | null, article: Element | null, doc?: Document, win?: Window,
 *   send?: (url: string, body: string) => boolean, now?: () => number }} options
 */
export function initPageBeacon({ apiBase, postId, article, doc = document, win = window, send, now = Date.now }) {
  // The owner's own reading (edit links visible) would skew the numbers.
  if (!apiBase || doc.querySelector('.admin-links')) return;
  let depth = 0;
  let visibleMs = 0;
  let visibleSince = doc.visibilityState === 'visible' ? now() : null;
  let sent = false;

  const measure = () => {
    if (!article) return;
    const rect = article.getBoundingClientRect();
    depth = Math.max(depth, depthReached({ top: rect.top + win.scrollY, height: rect.height }, win.scrollY + win.innerHeight));
  };
  const pause = () => {
    if (visibleSince !== null) visibleMs += now() - visibleSince;
    visibleSince = null;
  };
  const flush = () => {
    pause();
    if (sent) return;
    sent = true;
    const view = {
      type: 'view',
      path: win.location.pathname.slice(0, MAX_PATH_CHARS),
      postId,
      referrer: doc.referrer,
      depth,
      seconds: Math.floor(visibleMs / 1000),
    };
    sendEvent(apiBase, view, send); // send undefined -> sendEvent's sendBeacon default
  };

  measure();
  win.addEventListener('scroll', measure, { passive: true });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') flush();
    else visibleSince = now();
  });
  // Safari may skip visibilitychange on navigation; pagehide covers it (flush sends only once).
  win.addEventListener('pagehide', flush);
}
