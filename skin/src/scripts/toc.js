const HEADING_SELECTOR = 'h1, h2, h3, h4';
// Blocks Tistory appends inside the post body; their headings are not part of the post.
const INJECTED = '.another_category, .container_postbtn, .tt_box_namecard';

/**
 * Fills `list` with links to the headings inside `article`. Uses textContent only (no HTML injection).
 * @param {HTMLElement} article
 * @param {HTMLOListElement} list
 * @returns {HTMLElement[]} headings that got a TOC entry
 */
export function buildToc(article, list) {
  const headings = [...article.querySelectorAll(HEADING_SELECTOR)].filter((h) => h.textContent.trim() && !h.closest(INJECTED));
  const topLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));

  const items = headings.map((heading, index) => {
    if (!heading.id) heading.id = `toc-${index + 1}`;
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent.trim();
    const item = document.createElement('li');
    item.className = `toc-depth-${Number(heading.tagName[1]) - topLevel}`;
    item.append(link);
    return item;
  });

  list.replaceChildren(...items);
  return headings;
}

function trackActive(headings, list) {
  if (!('IntersectionObserver' in window)) return;
  const links = new Map([...list.querySelectorAll('a')].map((a) => [a.hash.slice(1), a]));
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (!visible) return;
      links.forEach((link) => link.removeAttribute('aria-current'));
      links.get(visible.target.id)?.setAttribute('aria-current', 'true');
    },
    { rootMargin: '0px 0px -70% 0px' },
  );
  headings.forEach((heading) => observer.observe(heading));
}

/**
 * @param {HTMLElement | null} container element with [data-toc]
 * @param {HTMLElement | null} article post body
 */
export function initToc(container, article) {
  if (!container) return;
  const list = container.querySelector('.toc-list');
  const headings = article && list ? buildToc(article, list) : [];
  if (headings.length === 0) {
    container.hidden = true;
    return;
  }

  const toggle = container.querySelector('[data-toc-toggle]');
  toggle?.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
  });
  trackActive(headings, list);
}
