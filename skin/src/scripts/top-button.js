const SHOW_AFTER_PX = 400;

/** @param {HTMLButtonElement | null} button */
export function initTopButton(button) {
  if (!button) return;
  const update = () => {
    button.hidden = window.scrollY < SHOW_AFTER_PX;
  };
  window.addEventListener('scroll', update, { passive: true });
  button.addEventListener('click', () => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
  update();
}
