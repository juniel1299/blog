import { afterEach, describe, expect, test, vi } from 'vitest';
import { initSimilar } from '../src/scripts/similar.js';

const card = (postId, title) => ({ postId, title, url: `https://b/${postId}`, category: 'JavaScript/React', preview: `p${postId}` });

function page() {
  document.body.innerHTML = '<article><div id="article-body"></div><nav class="post-nav"></nav></article>';
  return document.querySelector('.post-nav');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('initSimilar', () => {
  test('puts up to 3 similar posts above the previous/next links', async () => {
    const nav = page();
    const similar = vi.fn(async () => [card(99, 'useReducer'), card(97, '생명주기'), card(110, 'useState'), card(1, 'extra')]);
    await initSimilar(nav, 'https://api', 98, similar);

    expect(similar).toHaveBeenCalledWith('https://api', 98);
    const box = nav.previousElementSibling;
    expect(box.className).toBe('similar');
    expect(box.querySelector('h2').textContent).toBe('이 글과 비슷한 글');
    const links = [...box.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['useReducer', 'https://b/99'],
      ['생명주기', 'https://b/97'],
      ['useState', 'https://b/110'],
    ]);
    expect(box.querySelector('.similar-preview').textContent).toBe('p99');
  });

  test('titles are text, never HTML', async () => {
    const nav = page();
    await initSimilar(nav, 'https://api', 98, async () => [card(5, '<img src=x onerror=alert(1)>')]);
    expect(nav.previousElementSibling.querySelector('img')).toBeNull();
    expect(nav.previousElementSibling.querySelector('a').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('nothing similar, an API failure, or a non-post page leaves the page as it was', async () => {
    const nav = page();
    await initSimilar(nav, 'https://api', 98, async () => []);
    await initSimilar(nav, 'https://api', 98, async () => {
      throw new Error('down');
    });
    await initSimilar(nav, 'https://api', null, vi.fn());
    await initSimilar(nav, '', 98, vi.fn());
    await initSimilar(null, 'https://api', 98, vi.fn());
    expect(document.querySelector('.similar')).toBeNull();
  });
});
