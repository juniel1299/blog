import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { parseReferrer } from '../src/events.js';

const BLOG = 'https://problem-child.tistory.com';

describe('parseReferrer', () => {
  test.each([
    ['', { host: null, engine: null, query: null }],
    [`${BLOG}/category/java`, { host: 'internal', engine: null, query: null }],
    ['https://search.naver.com/search.naver?where=nexearch&query=%EC%9E%90%EB%B0%94+%EC%83%81%EC%86%8D', { host: 'search.naver.com', engine: 'naver', query: '자바 상속' }],
    ['https://m.search.daum.net/search?w=tot&q=useEffect', { host: 'm.search.daum.net', engine: 'daum', query: 'useEffect' }],
    ['https://www.google.com/', { host: 'www.google.com', engine: 'google', query: null }],
    ['https://www.bing.com/search?q=oracle+index', { host: 'www.bing.com', engine: 'bing', query: 'oracle index' }],
    ['https://velog.io/@someone/post?ref=abc', { host: 'velog.io', engine: null, query: null }],
    ['not a url', { host: null, engine: null, query: null }],
  ])('%s', (referrer, expected) => {
    expect(parseReferrer(referrer, BLOG)).toEqual(expected);
  });

  test('long search queries are cut to 100 chars', () => {
    const q = 'a'.repeat(300);
    expect(parseReferrer(`https://search.naver.com/search.naver?query=${q}`, BLOG).query).toHaveLength(100);
  });
});

describe('POST /api/v1/events', () => {
  function env({ fail = false } = {}) {
    const inserted = [];
    return {
      inserted,
      BLOG_ORIGIN: BLOG,
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            run: async () => {
              if (fail) throw new Error('d1 down');
              inserted.push({ table: sql.match(/INSERT INTO (\w+)/)[1], args });
            },
          }),
        }),
      },
    };
  }

  // sendBeacon posts a text/plain string, so the body is read as text.
  const send = (body, e = env()) =>
    worker.fetch(
      new Request('https://api.test/api/v1/events', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
      e,
      {},
    );

  afterEach(() => vi.restoreAllMocks());

  test('a page view stores path, post, referrer host, search keyword, depth and seconds (no full URL)', async () => {
    const e = env();
    const res = await send(
      { type: 'view', path: '/98', postId: 98, referrer: 'https://search.naver.com/search.naver?query=useEffect', depth: 75, seconds: 42 },
      e,
    );
    expect(res.status).toBe(204);
    expect(e.inserted).toEqual([{ table: 'page_views', args: ['/98', 98, 'search.naver.com', 'naver', 'useEffect', 75, 42] }]);
  });

  test('a card click stores the post, its position, where it was shown and the question', async () => {
    const e = env();
    const res = await send({ type: 'click', postId: 119, position: 1, source: 'answer', query: '  Redux랑   Zustand 차이? ' }, e);
    expect(res.status).toBe(204);
    expect(e.inserted).toEqual([{ table: 'result_clicks', args: [119, 1, 'answer', 'redux랑 zustand 차이?'] }]);
  });

  test.each([
    ['unknown type', { type: 'scroll' }],
    ['path not starting with /', { type: 'view', path: 'https://evil', postId: null, depth: 0, seconds: 1 }],
    ['odd depth', { type: 'view', path: '/', postId: null, depth: 33, seconds: 1 }],
    ['negative seconds', { type: 'view', path: '/', postId: null, depth: 0, seconds: -1 }],
    ['click without post', { type: 'click', position: 1, source: 'chat' }],
    ['bad source', { type: 'click', postId: 1, position: 1, source: 'evil' }],
    ['position out of range', { type: 'click', postId: 1, position: 99, source: 'chat' }],
    ['too big', { type: 'view', path: `/${'a'.repeat(3000)}`, postId: null, depth: 0, seconds: 1 }],
    ['not json', '{'],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
  });

  test('a storage failure is a quiet 204 (analytics must never break the page) and is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send({ type: 'view', path: '/', postId: null, depth: 0, seconds: 3 }, env({ fail: true }));
    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalled();
  });

  test('GET is not allowed', async () => {
    expect((await worker.fetch(new Request('https://api.test/api/v1/events'), env(), {})).status).toBe(405);
  });
});
