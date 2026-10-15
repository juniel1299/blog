import { createRoot } from 'react-dom/client';
import { ChatWidget } from './ChatWidget.jsx';

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
    root.render(<ChatWidget />);
    return root;
  } catch (error) {
    // Keep the rest of the skin working if the widget fails.
    console.error('[ai-assistant] mount failed', error);
    return null;
  }
}
