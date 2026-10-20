import { searchBlog } from '../widget/api.js';

const MIN_CHARS = 2;
const MAX_RESULTS = 3;
const DEBOUNCE_MS = 300;
const PANEL_ID = 'search-panel';

function resultLink(result, index) {
  const a = document.createElement('a');
  a.className = 'search-item';
  a.id = `${PANEL_ID}-${index}`;
  a.href = result.url;
  a.setAttribute('role', 'option');
  a.setAttribute('aria-selected', 'false');
  const title = document.createElement('span');
  title.className = 'search-item-title';
  title.textContent = result.title;
  const meta = document.createElement('span');
  meta.className = 'search-item-meta';
  meta.textContent = [result.category, result.preview].filter(Boolean).join(' · ');
  a.append(title, meta);
  return a;
}

/** Results (or a message) plus a row that runs Tistory's own full-text search. textContent only. */
function renderPanel(panel, query, { results = [], message = '' }) {
  const rows = results.map(resultLink);
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = message || '일치하는 글이 없어요.';
    rows.push(empty);
  }
  const all = document.createElement('button');
  all.type = 'submit';
  all.className = 'search-all';
  all.textContent = `'${query}' 전체 검색 결과 보기`;
  panel.replaceChildren(...rows, all);
}

/**
 * Turns the header search box into a live hybrid search (same API as the chatbot). Enter on a picked
 * result opens it; otherwise the form keeps Tistory's native search, which also covers any API failure.
 * @param {HTMLInputElement | null} input
 * @param {string} apiBase empty = leave the native search alone
 * @param {{ search?: typeof searchBlog, navigate?: (url: string) => void, delay?: number }} [options]
 */
export function initHeaderSearch(input, apiBase, options = {}) {
  if (!input?.form || !apiBase || input.dataset.liveSearch) return;
  const { search = searchBlog, navigate = (url) => window.location.assign(url), delay = DEBOUNCE_MS } = options;
  input.dataset.liveSearch = 'true';

  const panel = document.createElement('div');
  panel.className = 'search-panel';
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', '검색 결과');
  panel.hidden = true;
  input.form.append(panel);
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', PANEL_ID);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  // Repeats while typing/backspacing don't spend the shared rate limit (20/min with the chatbot).
  const cache = new Map();
  let timer;
  let latest = 0;
  let active = -1;

  const items = () => [...panel.querySelectorAll('.search-item')];
  const setOpen = (open) => {
    panel.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
  };
  const select = (index) => {
    active = index;
    items().forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    const current = items()[index];
    if (current) input.setAttribute('aria-activedescendant', current.id);
    else input.removeAttribute('aria-activedescendant');
  };

  async function run(query) {
    const ticket = ++latest;
    let view;
    try {
      if (!cache.has(query)) cache.set(query, (await search(apiBase, query)).results.slice(0, MAX_RESULTS));
      view = { results: cache.get(query) };
    } catch (error) {
      view = { message: error.message };
    }
    if (ticket !== latest) return;
    renderPanel(panel, query, view);
    select(-1);
    setOpen(true);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
      latest++;
      setOpen(false);
      return;
    }
    timer = setTimeout(() => run(query), delay);
  });

  input.addEventListener('keydown', (event) => {
    if (panel.hidden) return;
    const count = items().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      select((active + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      select(active <= 0 ? count - 1 : active - 1);
    } else if (event.key === 'Enter' && items()[active]) {
      event.preventDefault();
      navigate(items()[active].href);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  });

  input.addEventListener('focus', () => {
    if (panel.childElementCount && input.value.trim().length >= MIN_CHARS) setOpen(true);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!input.form.contains(event.target)) setOpen(false);
  });
}
