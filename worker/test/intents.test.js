import { afterEach, describe, expect, test, vi } from 'vitest';
import { categoryMatches, extractCategory, isRecentRequest } from '../src/search/intent.js';

vi.mock('../src/search/search.js', async (importOriginal) => ({
  ...(await importOriginal()),
  searchPosts: vi.fn(),
}));
vi.mock('../src/posts.js', () => ({ recentPosts: vi.fn(), similarPosts: vi.fn(), similarScores: vi.fn() }));

const { default: worker } = await import('../src/index.js');
const { searchPosts } = await import('../src/search/search.js');
const { recentPosts, similarPosts } = await import('../src/posts.js');

describe('intent parsing', () => {
  test('extractCategory pulls "X 카테고리(에서)" and applies Korean aliases', () => {
    expect(extractCategory('리액트 카테고리에서 상태관리 글')).toEqual({ category: 'react', rest: '상태관리 글' });
    expect(extractCategory('자바 카테고리 글 보여줘')).toEqual({ category: 'java', rest: '글 보여줘' });
    expect(extractCategory('CS 카테고리의 스택')).toEqual({ category: 'cs', rest: '스택' });
    expect(extractCategory('그냥 질문')).toEqual({ category: null, rest: '그냥 질문' });
  });

  test('categoryMatches compares whole path segments', () => {
    expect(categoryMatches('java/Spring', 'java')).toBe(true);
    expect(categoryMatches('JavaScript/React', 'java')).toBe(false);
    expect(categoryMatches('JavaScript/React', 'react')).toBe(true);
    expect(categoryMatches('SQL(oracle)', 'oracle')).toBe(true);
    expect(categoryMatches('CS + WEB', 'web')).toBe(true);
    expect(categoryMatches(null, 'java')).toBe(false);
  });

  test('isRecentRequest only for a bare "recent posts" ask', () => {
    expect(isRecentRequest('최근 글 보여줘')).toBe(true);
    expect(isRecentRequest('새로 올라온 글 있어?')).toBe(true);
    expect(isRecentRequest('최신 포스트')).toBe(true);
    expect(isRecentRequest('최근 리액트 글')).toBe(false);
    expect(isRecentRequest('인덱스 글 찾아줘')).toBe(false);
  });
});

describe('API paging and routes', () => {
  const pool = [1, 2, 3, 4, 5].map((postId) => ({ postId, title: `t${postId}`, url: `https://b/${postId}` }));
  const env = () => ({ DB: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) } });
  const post = (body) =>
    worker.fetch(new Request('https://api.test/api/v1/search', { method: 'POST', body: JSON.stringify(body) }), env(), {
      waitUntil: () => {},
    });
  const get = (path) => worker.fetch(new Request(`https://api.test${path}`), env(), {});

  afterEach(() => vi.clearAllMocks());

  test('first page: 3 results + hasMore; offset 3 returns the rest', async () => {
    searchPosts.mockResolvedValue(pool);
    const first = await (await post({ query: '리액트 훅' })).json();
    expect(first).toMatchObject({ mode: 'search', offset: 0, hasMore: true });
    expect(first.results.map((r) => r.postId)).toEqual([1, 2, 3]);

    const second = await (await post({ query: '리액트 훅', offset: 3 })).json();
    expect(second).toMatchObject({ offset: 3, hasMore: false });
    expect(second.results.map((r) => r.postId)).toEqual([4, 5]);
  });

  test.each([[6], [1], [-3], ['3']])('rejects offset %j', async (offset) => {
    expect((await post({ query: 'q', offset })).status).toBe(400);
  });

  test('category phrase routes to a category-scoped search', async () => {
    searchPosts.mockResolvedValue(pool.slice(0, 1));
    const body = await (await post({ query: '리액트 카테고리에서 상태관리' })).json();
    expect(searchPosts).toHaveBeenCalledWith(expect.anything(), '상태관리', { category: 'react' });
    expect(body).toMatchObject({ mode: 'category', category: 'react' });
  });

  test('"최근 글 보여줘" lists recent posts instead of searching', async () => {
    recentPosts.mockResolvedValue(pool);
    const body = await (await post({ query: '최근 글 보여줘' })).json();
    expect(searchPosts).not.toHaveBeenCalled();
    expect(body).toMatchObject({ mode: 'recent', hasMore: true });
  });

  test('GET /api/v1/posts/recent and /:id/similar', async () => {
    recentPosts.mockResolvedValue(pool.slice(0, 3));
    expect((await (await get('/api/v1/posts/recent')).json()).posts).toHaveLength(3);
    expect(recentPosts).toHaveBeenCalledWith(expect.anything(), { limit: 3 });

    similarPosts.mockResolvedValueOnce(pool.slice(0, 2)).mockResolvedValueOnce(null);
    const ok = await get('/api/v1/posts/98/similar');
    expect(ok.status).toBe(200);
    expect((await ok.json()).posts).toHaveLength(2);
    expect((await get('/api/v1/posts/99999/similar')).status).toBe(404);
  });
});
