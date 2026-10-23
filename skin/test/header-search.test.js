import { afterEach, describe, expect, test, vi } from 'vitest';
import { initHeaderSearch } from '../src/scripts/header-search.js';
import { SearchError } from '../src/widget/api.js';

const results = [
  { postId: 98, title: '[React] 7. useEffect', url: 'https://b/98', category: 'JavaScript/React', heading: null, preview: 'effect 설명' },
  { postId: 99, title: '[React] 8. useReducer', url: 'https://b/99', category: 'JavaScript/React', heading: null, preview: 'reducer' },
];

function setup(search, navigate = vi.fn(), track = vi.fn()) {
  document.body.innerHTML =
    '<form class="search" role="search"><input id="search-input" type="search"></form><p id="outside">x</p>';
  const input = document.getElementById('search-input');
  const submit = vi.fn((event) => event.preventDefault());
  input.form.addEventListener('submit', submit);
  initHeaderSearch(input, 'https://api', { search, navigate, track, delay: 0 });
  return { input, submit, navigate, track, panel: () => document.querySelector('.search-panel') };
}

const type = async (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 5));
};
const press = (input, key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('header search', () => {
  test('shows hybrid results as links plus a full-search row', async () => {
    const search = vi.fn(async () => ({ results }));
    const { input, panel } = setup(search);
    await type(input, 'useEffect');

    expect(search).toHaveBeenCalledWith('https://api', 'useEffect', { source: 'header' });
    const links = panel().querySelectorAll('a.search-item');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['https://b/98', 'https://b/99']);
    expect(links[0].querySelector('.search-item-title').textContent).toBe('[React] 7. useEffect');
    expect(panel().querySelector('.search-all').textContent).toContain('useEffect');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  test('ignores 1-character queries and caches repeats', async () => {
    const search = vi.fn(async () => ({ results }));
    const { input, panel } = setup(search);
    await type(input, 'a');
    expect(search).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(true);

    await type(input, 'react');
    await type(input, 'reac');
    await type(input, 'react');
    expect(search).toHaveBeenCalledTimes(2);
  });

  test('arrow keys pick a result and Enter opens it instead of the native search', async () => {
    const { input, submit, navigate, track, panel } = setup(async () => ({ results }));
    await type(input, 'react');

    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    const selected = panel().querySelector('[aria-selected="true"]');
    expect(selected.getAttribute('href')).toBe('https://b/99');
    expect(input.getAttribute('aria-activedescendant')).toBe(selected.id);

    expect(press(input, 'Enter').defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('https://b/99');
    expect(submit).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('https://api', { type: 'click', postId: 99, position: 2, source: 'header', query: 'react' });
  });

  test('mouse clicks on a result are recorded too', async () => {
    const { input, track, panel } = setup(async () => ({ results }));
    await type(input, 'useEffect');
    panel().querySelector('a.search-item').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(track).toHaveBeenCalledWith('https://api', { type: 'click', postId: 98, position: 1, source: 'header', query: 'useEffect' });
  });

  test('Enter without a picked result keeps the native Tistory search', async () => {
    const { input, navigate } = setup(async () => ({ results }));
    await type(input, 'react');
    expect(press(input, 'Enter').defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  test('Escape and outside clicks close the panel; focus reopens it', async () => {
    const { input, panel } = setup(async () => ({ results }));
    await type(input, 'react');
    press(input, 'Escape');
    expect(panel().hidden).toBe(true);

    input.dispatchEvent(new Event('focus'));
    expect(panel().hidden).toBe(false);
    document.getElementById('outside').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(panel().hidden).toBe(true);
  });

  test('no results and errors still offer the native search row', async () => {
    const { input, panel } = setup(async (_base, query) => {
      if (query === 'down') throw new SearchError('network', '연결 실패');
      return { results: [] };
    });
    await type(input, 'zzz');
    expect(panel().querySelector('.search-empty').textContent).toBe('일치하는 글이 없어요.');
    expect(panel().querySelector('.search-all')).not.toBeNull();

    await type(input, 'down');
    expect(panel().querySelector('.search-empty').textContent).toBe('연결 실패');
  });

  test('a slow older response does not overwrite a newer one', async () => {
    let releaseOld;
    const search = vi.fn((_base, query) =>
      query === 'old' ? new Promise((r) => (releaseOld = () => r({ results }))) : Promise.resolve({ results: [] }),
    );
    const { input, panel } = setup(search);
    await type(input, 'old');
    await type(input, 'new');
    releaseOld();
    await new Promise((r) => setTimeout(r, 0));
    expect(panel().querySelector('.search-item')).toBeNull();
    expect(panel().querySelector('.search-empty')).not.toBeNull();
  });

  test('does nothing without an API base or input', () => {
    document.body.innerHTML = '<form><input id="i"></form>';
    initHeaderSearch(document.getElementById('i'), '');
    initHeaderSearch(null, 'https://api');
    expect(document.querySelector('.search-panel')).toBeNull();
  });
});
