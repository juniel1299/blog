/**
 * Thin bar at the top showing how far the post body has been read. Only runs on post pages.
 * @param {HTMLElement | null} bar
 * @param {HTMLElement | null} article
 */
export function initReadProgress(bar, article) {
  if (!bar || !article) return;
  const update = () => {
    const { top, height } = article.getBoundingClientRect();
    const scrollable = height - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(Math.max(-top / scrollable, 0), 1) : 1;
    bar.style.transform = `scaleX(${ratio})`;
  };
  bar.classList.add('is-active');
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}
