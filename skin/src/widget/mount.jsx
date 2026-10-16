import { createRoot } from 'react-dom/client';
import { ChatWidget } from './ChatWidget.jsx';

/**
 * Post number when this is a Tistory post page (body#tt-body-page, path "/123"), else null.
 * @param {{ pathname: string }} location
 * @param {string} bodyId
 */
export function currentPostId(location, bodyId) {
  if (bodyId !== 'tt-body-page') return null;
  const match = location.pathname.match(/^\/(\d{1,9})\/?$/);
  return match ? Number(match[1]) : null;
}

/**
 * Mounts the widget once per element. A dataset flag (not module state) also guards against
 * the script being included twice on the page.
 * @param {HTMLElement | null} element
 * @returns {import('react-dom/client').Root | null} null when skipped or failed
 */
export function mountWidget(element) {
  if (!element || element.dataset.aiaMounted) return null;
  element.dataset.aiaMounted = 'true';
  try {
    const root = createRoot(element);
    root.render(
      <ChatWidget apiBase={element.dataset.apiBase ?? ''} currentPostId={currentPostId(window.location, document.body.id)} />,
    );
    return root;
  } catch (error) {
    // Keep the rest of the skin working if the widget fails.
    console.error('[ai-assistant] mount failed', error);
    return null;
  }
}
