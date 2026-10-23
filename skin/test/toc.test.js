import { beforeEach, describe, expect, test } from 'vitest';
import { initToc } from '../src/scripts/toc.js';

function setup(bodyHtml) {
  document.body.innerHTML = `
    <div id="article-body">${bodyHtml}</div>
    <aside data-toc>
      <button data-toc-toggle aria-expanded="false">목차</button>
      <ol class="toc-list"></ol>
    </aside>`;
  const container = document.querySelector('[data-toc]');
  initToc(container, document.getElementById('article-body'));
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('toc', () => {
  test('builds links for headings with depth relative to the top level', () => {
    const container = setup('<h2>Intro</h2><h3>Detail</h3><h2 id="keep">Next</h2><h3> </h3>');
    const items = [...container.querySelectorAll('li')];

    expect(items.map((li) => li.textContent)).toEqual(['Intro', 'Detail', 'Next']);
    expect(items.map((li) => li.className)).toEqual(['toc-depth-0', 'toc-depth-1', 'toc-depth-0']);
    expect(items[2].querySelector('a').getAttribute('href')).toBe('#keep');
    expect(document.getElementById(items[0].querySelector('a').hash.slice(1))?.textContent).toBe('Intro');
  });

  test("skips headings in blocks Tistory injects into the post body (e.g. the category's other posts)", () => {
    const container = setup(
      '<h2>Intro</h2><div class="another_category"><h4>\'React\' 카테고리의 다른 글</h4></div><div class="container_postbtn"><h3>공유</h3></div>',
    );
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Intro']);
    expect(container.querySelector('li').className).toBe('toc-depth-0');
  });

  test('renders heading text, not HTML', () => {
    const container = setup('<h2>&lt;img src=x onerror=alert(1)&gt;</h2>');
    expect(container.querySelector('img')).toBeNull();
  });

  test('hides itself when the post has no headings', () => {
    expect(setup('<p>no headings</p>').hidden).toBe(true);
  });

  test('mobile toggle flips aria-expanded', () => {
    const toggle = setup('<h2>A</h2>').querySelector('[data-toc-toggle]');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  test('missing article hides the toc instead of throwing', () => {
    document.body.innerHTML = '<aside data-toc><ol class="toc-list"></ol></aside>';
    const container = document.querySelector('[data-toc]');
    initToc(container, null);
    expect(container.hidden).toBe(true);
  });
});
