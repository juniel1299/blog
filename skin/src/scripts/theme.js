const STORAGE_KEY = 'theme';
const THEMES = ['light', 'dark'];

/** @returns {'light' | 'dark'} */
export function currentTheme(root = document.documentElement) {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** @returns {'light' | 'dark'} */
export function initialTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): fall back to the OS setting.
  }
  if (THEMES.includes(stored)) return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @returns {'light' | 'dark'} the theme now applied */
export function toggleTheme(root = document.documentElement) {
  const next = currentTheme(root) === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage blocked: the theme still applies, it just isn't remembered.
  }
  return next;
}

function render(button, theme) {
  button.setAttribute('aria-pressed', String(theme === 'dark'));
  button.textContent = theme === 'dark' ? '☀' : '☾';
}

/** @param {HTMLButtonElement | null} button */
export function initThemeToggle(button, root = document.documentElement) {
  if (!button) return;
  if (!root.dataset.theme) root.dataset.theme = initialTheme();
  render(button, currentTheme(root));
  button.addEventListener('click', () => render(button, toggleTheme(root)));
}
