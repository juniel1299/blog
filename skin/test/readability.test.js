import { afterEach, describe, expect, test, vi } from 'vitest';
import { initCodeBlocks } from '../src/scripts/code-blocks.js';
import { initPostMeta, modifiedDate, readingMinutes } from '../src/scripts/post-meta.js';
import { initSeries, renderSeries } from '../src/scripts/series.js';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('code blocks', () => {
  test('adds a language label and a copy button outside <pre>, once', async () => {
    document.body.innerHTML = '<div id="a"><pre class="javascript" data-ke-language="javascript">const a = 1;</pre></div>';
    const article = document.getElementById('a');
    const clipboard = { writeText: vi.fn(async () => {}) };
    initCodeBlocks(article, clipboard);
    initCodeBlocks(article, clipboard);

    expect(article.querySelectorAll('.code-block')).toHaveLength(1);
    expect(article.querySelector('.code-lang').textContent).toBe('JavaScript');
    expect(article.querySelector('pre').textContent).toBe('const a = 1;');

    const button = article.querySelector('.code-copy');
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('복사됨');
  });

  test('shows a failure message when the clipboard is unavailable', async () => {
    document.body.innerHTML = '<div id="a"><pre>x</pre></div>';
    initCodeBlocks(document.getElementById('a'), { writeText: async () => Promise.reject(new Error('denied')) });
    const button = document.querySelector('.code-copy');
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(button.textContent).toBe('복사 실패');
    expect(document.querySelector('.code-lang').textContent).toBe('');
  });

  test('highlights code in the language the editor declared, keeping the text', () => {
    document.body.innerHTML = '<div id="a"><pre data-ke-language="javascript"><code>const a = "x"; // c</code></pre></div>';
    initCodeBlocks(document.getElementById('a'));
    const code = document.querySelector('pre code');
    expect(code.classList.contains('hljs')).toBe(true);
    expect(code.querySelector('.hljs-keyword').textContent).toBe('const');
    expect(code.querySelector('.hljs-string').textContent).toBe('"x"');
    expect(code.textContent).toBe('const a = "x"; // c');
  });

  test("ignores the old editor's wrong class names and guesses from the code within the post's category", () => {
    const java = 'String hello1 = "안녕";\nSystem.out.println(hello1);\npublic static void main(String[] args) { int sum = 0; }';
    document.body.innerHTML = `<div id="a"><pre class="angelscript"><code>${java}</code></pre></div>`;
    initCodeBlocks(document.getElementById('a'), undefined, 'java');
    expect(document.querySelector('.code-lang').textContent).toBe('Java');
    expect(document.querySelector('pre code').textContent).toBe(java);
  });

  test('code that looks like HTML stays text', () => {
    const src = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const pre = document.createElement('pre');
    pre.setAttribute('data-ke-language', 'xml');
    pre.textContent = src;
    document.body.innerHTML = '<div id="a"></div>';
    document.getElementById('a').append(pre);
    initCodeBlocks(document.getElementById('a'));
    expect(document.querySelector('#a script, #a img')).toBeNull();
    expect(pre.textContent).toBe(src);
  });

  test('in a single-language category even one short line is highlighted', () => {
    document.body.innerHTML = '<div id="a"><pre class="abnf"><code>long l1 = 3000000000L;</code></pre></div>';
    initCodeBlocks(document.getElementById('a'), undefined, 'java');
    expect(document.querySelector('.code-lang').textContent).toBe('Java');
    expect(document.querySelector('pre code .hljs-type, pre code .hljs-keyword')).not.toBeNull();
  });

  test('too little code to tell gets no label and no colors', () => {
    document.body.innerHTML = '<div id="a"><pre class="routeros"><code>hello</code></pre></div>';
    initCodeBlocks(document.getElementById('a'));
    expect(document.querySelector('.code-lang').textContent).toBe('');
    expect(document.querySelector('pre code').innerHTML).toBe('hello');
  });
});

describe('post meta', () => {
  test('reading minutes from character count, at least 1', () => {
    expect(readingMinutes('가'.repeat(1500))).toBe(3);
    expect(readingMinutes('짧음')).toBe(1);
  });

  test('modified date only when edited a day or more after publishing', () => {
    const ld = (p, m) => `<script type="application/ld+json">${JSON.stringify({ datePublished: p, dateModified: m })}</script>`;
    document.head.innerHTML = ld('2025-10-08T18:00:00+09:00', '2025-10-08T18:01:00+09:00');
    expect(modifiedDate()).toBeNull();
    document.head.innerHTML = ld('2025-10-08T18:00:00+09:00', '2025-10-12T09:00:00+09:00');
    expect(modifiedDate()?.toISOString()).toBe('2025-10-12T00:00:00.000Z');
  });

  test('appends reading time to the meta line', () => {
    document.body.innerHTML = '<p class="post-meta"><time>2025</time></p><div id="a">본문</div>';
    initPostMeta(document.querySelector('.post-meta'), document.getElementById('a'));
    expect(document.querySelector('.post-reading').textContent).toBe('1분 읽기');
    expect(document.querySelector('.post-updated')).toBeNull();
  });
});

describe('series', () => {
  const series = {
    name: 'React',
    posts: [
      { postId: 97, title: '[React] 6. 생명주기', url: 'https://b/97' },
      { postId: 98, title: '[React] 7. useEffect', url: 'https://b/98' },
      { postId: 99, title: '[React] 8. useReducer', url: 'https://b/99' },
    ],
  };

  test('renders position, episode list and prev/next links', () => {
    const box = renderSeries(series, 98);
    expect(box.querySelector('.series-pos').textContent).toBe('2 / 3');
    expect(box.querySelector('[aria-current="page"]').textContent).toBe('[React] 7. useEffect');
    expect(box.querySelector('.series-prev').getAttribute('href')).toBe('https://b/97');
    expect(box.querySelector('.series-next').getAttribute('href')).toBe('https://b/99');
  });

  test('no box when the post is not in the list or links are unsafe', () => {
    expect(renderSeries(series, 1)).toBeNull();
    expect(renderSeries({ name: 'x', posts: series.posts.map((p) => ({ ...p, url: 'javascript:x' })) }, 98)).toBeNull();
  });

  test('initSeries inserts the box after the header; failures are silent', async () => {
    document.body.innerHTML = '<header class="post-header"></header>';
    const header = document.querySelector('.post-header');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ series })));
    await initSeries(header, 'https://api', 98, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://api/api/v1/posts/98/series');
    expect(header.nextElementSibling.classList.contains('series')).toBe(true);

    await expect(initSeries(header, 'https://api', 98, async () => { throw new Error('down'); })).resolves.toBeUndefined();
    await initSeries(header, '', 98, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
