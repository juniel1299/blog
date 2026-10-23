import { describe, expect, test } from 'vitest';
import worker from '../src/index.js';
import { insights } from '../src/insights.js';

const TOKEN = 'a'.repeat(48);

/** D1 stand-in: each insights query is tagged with a block comment like /* posts *\/. */
function env(rows = {}) {
  const pick = (sql) => {
    const tag = sql.match(/\/\* (\w+) \*\//)?.[1];
    if (tag) return rows[tag] ?? [];
    if (sql.includes('FROM search_misses')) return rows.misses ?? [];
    if (sql.includes('GROUP BY vote')) return rows.votes ?? [];
    if (sql.includes('FROM search_feedback')) return rows.feedback ?? [];
    return [];
  };
  return {
    ADMIN_TOKEN: TOKEN,
    DB: {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => ({ results: pick(sql) }),
          first: async () => pick(sql)[0] ?? null,
        }),
      }),
    },
  };
}

const FULL = {
  summary: [{ views: 40, post_views: 40, avg_seconds: 61.6, avg_depth: 52.4, read_through: 10, questions: 12, answers: 4, clicks: 9 }],
  daily: [{ day: '2026-10-23', views: 15 }, { day: '2026-10-24', views: 25 }],
  posts: [
    { post_id: 98, title: '[React] 7. useEffect', url: 'https://b/98', views: 20, avg_seconds: 90.2, read_rate: 0.45 },
    { post_id: 122, title: 'Index 란?', url: 'https://b/122', views: 8, avg_seconds: 30, read_rate: 0.25 },
    { post_id: 5, title: null, url: null, views: 1, avg_seconds: 3, read_rate: 0 },
  ],
  prev: [{ post_id: 98, views: 22 }, { post_id: 122, views: 1 }],
  post_clicks: [{ post_id: 122, clicks: 4 }],
  sources: [{ source: 'naver', n: 20 }, { source: 'direct', n: 15 }, { source: 'internal', n: 5 }],
  referrers: [{ host: 'velog.io', n: 2 }],
  keywords: [{ query: '오라클 인덱스', engine: 'naver', n: 6 }],
  questions: [{ query: '리액트 상태관리', n: 5, answers: 0 }, { query: 'useeffect 언제?', n: 2, answers: 2 }],
  query_clicks: [{ query: '리액트 상태관리', clicks: 4 }],
  click_sources: [{ source: 'chat', n: 6 }, { source: 'header', n: 3 }],
  misses: [{ query: '쿠버네티스', count: 3, last_seen: 'x' }],
  votes: [{ vote: 'up', count: 7 }, { vote: 'down', count: 2 }],
  feedback: [
    { query: '자바 람다', down: 2, up: 0, last_post_ids: '[47]', last_seen: 'x' },
    { query: '좋은 질문', down: 0, up: 3, last_post_ids: '[1]', last_seen: 'x' },
  ],
};

describe('insights', () => {
  test('summary numbers are rounded and rates are shares of views', async () => {
    const { summary } = await insights(env(FULL), 7);
    expect(summary).toEqual({
      views: 40,
      avgSeconds: 62,
      avgDepth: 52,
      readThroughRate: 0.25,
      questions: 12,
      answers: 4,
      misses: 3,
      clicks: 9,
      up: 7,
      down: 2,
    });
  });

  test('posts carry the change from the previous period and chat clicks; rising keeps real gains only', async () => {
    const result = await insights(env(FULL), 7);
    expect(result.posts.map((p) => [p.postId, p.views, p.prevViews, p.change, p.chatClicks])).toEqual([
      [98, 20, 22, -2, 0],
      [122, 8, 1, 7, 4],
      [5, 1, 0, 1, 0],
    ]);
    expect(result.posts[2].title).toBe('(삭제되었거나 색인 전인 글 #5)');
    // post 5 gained too, but 1 view is noise
    expect(result.rising.map((p) => p.postId)).toEqual([122]);
  });

  test('questions get their click count and click-through rate; disliked lists only 👎 questions', async () => {
    const result = await insights(env(FULL), 7);
    expect(result.questions).toEqual([
      { query: '리액트 상태관리', count: 5, answers: 0, clicks: 4, clickRate: 0.8 },
      { query: 'useeffect 언제?', count: 2, answers: 2, clicks: 0, clickRate: 0 },
    ]);
    expect(result.disliked).toEqual([{ query: '자바 람다', down: 2, up: 0 }]);
    expect(result.misses).toEqual([{ query: '쿠버네티스', count: 3 }]);
  });

  test('an empty database gives zeros, never NaN', async () => {
    const result = await insights(
      env({ summary: [{ views: 0, post_views: 0, avg_seconds: null, avg_depth: null, read_through: null, questions: 0, answers: null, clicks: 0 }] }),
      30,
    );
    expect(result.summary).toMatchObject({ views: 0, avgSeconds: 0, avgDepth: 0, readThroughRate: 0, answers: 0, up: 0, down: 0 });
    expect(result.posts).toEqual([]);
    expect(result.rising).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('NaN');
  });
});

describe('GET /admin/insights', () => {
  const get = (path, token = TOKEN) =>
    worker.fetch(new Request(`https://api.test${path}`, { headers: { authorization: `Bearer ${token}` } }), env(FULL), {});

  test('returns the report for the period, never cached', async () => {
    const res = await get('/admin/insights?days=7');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ days: 7, summary: { views: 40 }, sources: [{ source: 'naver', n: 20 }, expect.anything(), expect.anything()] });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test.each(['0', '91', 'x'])('rejects days=%s', async (days) => {
    expect((await get(`/admin/insights?days=${days}`)).status).toBe(400);
  });

  test('wrong token looks like a missing page', async () => {
    expect((await get('/admin/insights?days=7', 'b'.repeat(48))).status).toBe(404);
  });
});
