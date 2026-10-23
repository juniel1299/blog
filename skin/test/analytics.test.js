import { afterEach, describe, expect, test, vi } from 'vitest';
import { depthReached, initPageBeacon } from '../src/scripts/analytics.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('depthReached', () => {
  // article spans 1000..3000px of the page; the bottom of the viewport is what has been "seen".
  test.each([
    [900, 0],
    [1400, 0],
    [1500, 25],
    [2100, 50],
    [2600, 75],
    [3000, 100],
    [5000, 100],
  ])('viewport bottom at %ipx -> %i%%', (viewportBottom, expected) => {
    expect(depthReached({ top: 1000, height: 2000 }, viewportBottom)).toBe(expected);
  });
});

function fakePage({ owner = false } = {}) {
  document.body.innerHTML = `${owner ? '<span class="admin-links"></span>' : ''}<div id="article-body"></div>`;
  const listeners = {};
  const doc = {
    referrer: 'https://search.naver.com/search.naver?query=useEffect',
    visibilityState: 'visible',
    querySelector: (sel) => document.querySelector(sel),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  const win = {
    location: { pathname: '/98' },
    scrollY: 0,
    innerHeight: 800,
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
  };
  return { doc, win, listeners };
}

describe('initPageBeacon', () => {
  // getBoundingClientRect is relative to the viewport, so the page offset is added back via scrollY.
  const article = { getBoundingClientRect: () => ({ top: 1000, height: 2000 }) };

  test('sends one view with path, post, referrer, deepest scroll and visible seconds when the page is hidden', () => {
    const { doc, win, listeners } = fakePage();
    const send = vi.fn(() => true);
    let clock = 0;
    initPageBeacon({ apiBase: 'https://api', postId: 98, article, doc, win, send, now: () => clock });

    // article top stays at 1000px of the page: viewport-relative top shrinks as you scroll
    article.getBoundingClientRect = () => ({ top: 1000 - win.scrollY, height: 2000 });
    win.scrollY = 1800; // viewport bottom at 2600px of the page -> 75%
    listeners.scroll();
    win.scrollY = 0;
    listeners.scroll();
    clock = 42_400;
    doc.visibilityState = 'hidden';
    listeners.visibilitychange();
    listeners.pagehide();

    expect(send).toHaveBeenCalledTimes(1);
    const [url, body] = send.mock.calls[0];
    expect(url).toBe('https://api/api/v1/events');
    expect(JSON.parse(body)).toEqual({
      type: 'view',
      path: '/98',
      postId: 98,
      referrer: 'https://search.naver.com/search.naver?query=useEffect',
      depth: 75,
      seconds: 42,
    });
  });

  test('pages without a post body report depth 0', () => {
    const { doc, win, listeners } = fakePage();
    const send = vi.fn(() => true);
    initPageBeacon({ apiBase: 'https://api', postId: null, article: null, doc, win, send, now: () => 0 });
    listeners.pagehide();
    expect(JSON.parse(send.mock.calls[0][1])).toMatchObject({ postId: null, depth: 0 });
  });

  test("the blog owner's own visits and pages without an API base send nothing", () => {
    const owner = fakePage({ owner: true });
    const send = vi.fn();
    initPageBeacon({ apiBase: 'https://api', postId: 98, article, doc: owner.doc, win: owner.win, send, now: () => 0 });
    expect(owner.listeners.pagehide).toBeUndefined();

    const noApi = fakePage();
    initPageBeacon({ apiBase: '', postId: 98, article, doc: noApi.doc, win: noApi.win, send, now: () => 0 });
    expect(noApi.listeners.pagehide).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
