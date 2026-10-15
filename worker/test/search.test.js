import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { makeSnippet, parseQuery } from '../src/search/query.js';
import { fuseRankings, selectRankings } from '../src/search/rank.js';
import { MIN_VECTOR_SCORE } from '../src/search/search.js';

describe('parseQuery', () => {
  test('strips the chat request phrasing and particles', () => {
    expect(parseQuery('PostgreSQL 인덱스에 대한 글 찾아줘')).toMatchObject({
      text: 'PostgreSQL 인덱스',
      terms: ['postgresql', '인덱스'],
      ftsQuery: '"postgresql" OR "인덱스"',
      likeTerms: [],
    });
  });

  test('2-char terms go to LIKE because trigram cannot match them', () => {
    const parsed = parseQuery('조인 관련 글 알려줘');
    expect(parsed.ftsQuery).toBeNull();
    expect(parsed.likeTerms).toEqual(['조인']);
  });

  test('FTS operators and quotes in user input stay inert', () => {
    expect(parseQuery('react" OR NEAR(x')).toMatchObject({ ftsQuery: '"react" OR "near"' });
  });

  test('falls back to the raw text when everything was stripped', () => {
    expect(parseQuery('찾아줘').text).toBe('찾아줘');
  });
});

describe('makeSnippet', () => {
  test('prefers the line that mentions a query term and truncates', () => {
    const text = '첫 줄\n인덱스는 데이터를 빠르게 찾기 위한 도구\n마지막';
    expect(makeSnippet(text, ['인덱스'])).toBe('인덱스는 데이터를 빠르게 찾기 위한 도구');
    expect(makeSnippet('가'.repeat(200), [], 10)).toBe(`${'가'.repeat(9)}…`);
  });

  test('skips short code-like lines in favor of a sentence', () => {
    expect(makeSnippet('SELECT *\nFROM emp\nINNER JOIN 은 양쪽 테이블에 모두 있는 행만 가져온다', ['join'])).toBe(
      'INNER JOIN 은 양쪽 테이블에 모두 있는 행만 가져온다',
    );
    expect(makeSnippet('SELECT *', ['x'])).toBe('SELECT *');
  });

  test('prefers Korean prose over code that mentions the term', () => {
    const text = 'const data.forEach((item) => {\nreturn item + 2;\nforEach 는 반환이 없는 반면 map 은 새로운 배열을 반환함';
    expect(makeSnippet(text, ['foreach'])).toBe('forEach 는 반환이 없는 반면 map 은 새로운 배열을 반환함');
  });
});

describe('fuseRankings', () => {
  test('rewards chunks found by both lists and keeps one chunk per post', () => {
    const top = fuseRankings([['1-0', '2-0', '1-1'], ['2-0', '3-0']], 3);
    expect(top.map((hit) => hit.chunkId)).toEqual(['2-0', '1-0', '3-0']);
  });

  test('respects the limit', () => {
    expect(fuseRankings([['1-0', '2-0', '3-0', '4-0']], 2)).toHaveLength(2);
  });
});

describe('selectRankings', () => {
  const floors = { strictFloor: 0.5, looseFloor: 0.4 };

  test('title/heading hits always count; body hits need a loosely related post', () => {
    const [strong, body, vector] = selectRankings(
      {
        strong: ['9-0'],
        body: ['60-3', '110-3'], // "오늘", "투자" in unrelated bodies
        vector: [{ id: '60-1', score: 0.45 }, { id: '5-0', score: 0.62 }],
      },
      floors,
    );
    expect(strong).toEqual(['9-0']);
    expect(body).toEqual(['60-3']); // post 60 has a 0.45 vector match; 110 has none
    expect(vector).toEqual(['5-0']);
  });
});

describe('POST /api/v1/search', () => {
  const rows = {
    '122-1': { chunk_id: '122-1', heading: '인덱스란?', text: '인덱스는 데이터를 빠르게 찾기 위한 도구', post_id: 122, title: 'Index 란?', url: 'https://b/122', category: 'SQL' },
    '7-0': { chunk_id: '7-0', heading: null, text: '관련 없는 글', post_id: 7, title: 'Other', url: 'https://b/7', category: 'X' },
  };

  function env({ ftsIds = ['122-1'], matches = [], limit = { success: true } } = {}) {
    return {
      ALLOWED_ORIGINS: 'https://blog.example.com',
      SEARCH_LIMITER: { limit: vi.fn(async () => limit) },
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2]] })) },
      VECTORIZE: { query: vi.fn(async () => ({ matches })) },
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            all: async () => {
              if (sql.includes('MATCH')) return { results: ftsIds.map((chunk_id) => ({ chunk_id })) };
              if (sql.includes('WHERE c.id IN')) return { results: args.map((id) => rows[id]).filter(Boolean) };
              return { results: [] };
            },
          }),
        }),
      },
    };
  }

  const post = (body, e = env(), headers = {}) =>
    worker.fetch(
      new Request('https://api.test/api/v1/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      e,
      { waitUntil: () => {} },
    );

  afterEach(() => vi.restoreAllMocks());

  test('returns cards with title, url and a one-line preview', async () => {
    const res = await post({ query: '인덱스 글 찾아줘' }, env(), { origin: 'https://blog.example.com' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://blog.example.com');
    expect(await res.json()).toMatchObject({
      query: '인덱스 글 찾아줘',
      results: [{ postId: 122, title: 'Index 란?', url: 'https://b/122', preview: '인덱스는 데이터를 빠르게 찾기 위한 도구' }],
    });
  });

  test('vector hits below the score floor are dropped, so off-topic questions find nothing', async () => {
    const e = env({ ftsIds: [], matches: [{ id: '7-0', score: MIN_VECTOR_SCORE - 0.01 }] });
    expect((await (await post({ query: '오늘 날씨 어때' }, e)).json()).results).toEqual([]);
  });

  test('vector hits above the floor are returned', async () => {
    const e = env({ ftsIds: [], matches: [{ id: '7-0', score: MIN_VECTOR_SCORE + 0.1 }] });
    expect((await (await post({ query: '의미가 비슷한 질문' }, e)).json()).results.map((r) => r.postId)).toEqual([7]);
  });

  test.each([
    ['empty', { query: '   ' }],
    ['too long', { query: 'a'.repeat(201) }],
    ['wrong type', { query: 1 }],
    ['not json', '{oops'],
  ])('rejects %s query with 400', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_QUERY');
  });

  test('rate limited by client IP', async () => {
    const e = env({ limit: { success: false } });
    const res = await post({ query: 'react' }, e);
    expect(res.status).toBe(429);
    expect(e.SEARCH_LIMITER.limit).toHaveBeenCalledWith({ key: '1.2.3.4' });
  });

  test('GET is not allowed', async () => {
    const res = await worker.fetch(new Request('https://api.test/api/v1/search'), env(), {});
    expect(res.status).toBe(405);
  });

  test('backend failure returns a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env();
    e.AI.run = vi.fn(async () => { throw new Error('ai internal detail'); });
    const res = await post({ query: 'react' }, e);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('internal detail');
  });
});
