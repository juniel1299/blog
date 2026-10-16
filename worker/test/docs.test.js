import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { matchDocs } from '../src/docs.js';

// The real curated seed, so these tests break if a seed edit makes matching worse.
const SEED = readFileSync(new URL('../seed/doc_links.sql', import.meta.url), 'utf8');
const DOCS = [...SEED.matchAll(/\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '(\[[^']*\])'\)/g)].map((m, i) => ({
  id: i + 1,
  technology: m[1],
  title: m[2],
  url: m[3],
  description: m[4],
  keywords: JSON.parse(m[5]),
}));

// Real posts from the blog (title/category/tags as indexed).
const POSTS = {
  mapForEach: {
    title: '[React] 화면에 뿌릴 때 map은 되는데 forEach는 안 되는 이유',
    category: 'JavaScript/React',
    tags: ['forEach', 'frontend', 'map', 'react', '리액트', '프론트엔드'],
  },
  oracleIndex: { title: '[Oracle SQL] Index 란? (ft. 뭐든 과하면 독이다)', category: 'SQL(oracle)', tags: ['index', 'Oracle', 'sql', '인덱스'] },
  reduxZustand: {
    title: '[React] 상태관리 Redux vs Zustand (ft. 마키마 ? 레제 ? )',
    category: 'JavaScript/React',
    tags: ['javascript', 'react', '리액트', '웹개발', '자바스크립트', '프론트엔드'],
  },
  cors: { title: '[WEB] CORS 에러란 ? ..', category: 'CS + WEB', tags: ['CORS', 'origin', 'web', '백엔드', '프론트엔드'] },
  diary: { title: '첫 입사 일주일 (ft.네가 하이닉스고 얘가 현대야)', category: '다양한 이야기/나의 코딩 관련 이야기', tags: ['SI', 'SM', '개발자', '일상', '회고'] },
};

const titles = (post) => matchDocs(post, DOCS).map((doc) => doc.title);

describe('matchDocs (real seed)', () => {
  test('seed parsed', () => {
    expect(DOCS).toHaveLength(41);
  });

  test('map/forEach post gets the specific docs, not generic React pages', () => {
    expect(titles(POSTS.mapForEach)).toEqual(['리스트 렌더링', 'Array.prototype.forEach() (MDN)', 'Array.prototype.map() (MDN)']);
  });

  test('Oracle index post gets the index concept doc first', () => {
    expect(titles(POSTS.oracleIndex)[0]).toBe('Indexes and Index-Organized Tables');
  });

  test('state-management post surfaces Redux and Zustand from the title', () => {
    expect(titles(POSTS.reduxZustand)).toEqual(expect.arrayContaining(['Redux 시작하기', 'Zustand 소개']));
  });

  test('CORS post gets CORS doc first', () => {
    expect(titles(POSTS.cors)[0]).toBe('CORS (MDN)');
  });

  test('non-technical post gets nothing rather than noise', () => {
    expect(titles(POSTS.diary)).toEqual([]);
  });

  test('Korean title words match whole: "자바" does not match "자바스크립트"', () => {
    const javaOnly = DOCS.filter((doc) => doc.technology === 'java');
    expect(matchDocs({ title: '자바스크립트 이야기', category: null, tags: [] }, javaOnly)).toEqual([]);
    expect(matchDocs({ title: '자바의 기본 성질', category: null, tags: [] }, javaOnly).length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/posts/:postId/docs', () => {
  const row = { title: POSTS.cors.title, category: POSTS.cors.category, tags: JSON.stringify(POSTS.cors.tags) };
  const env = ({ post = row, fail = false } = {}) => ({
    DB: {
      prepare: (sql) => ({
        bind: () => ({ first: async () => post }),
        all: async () => {
          if (fail) throw new Error('d1 internal detail');
          return sql.includes('doc_links') ? { results: DOCS.map((d) => ({ ...d, keywords: JSON.stringify(d.keywords) })) } : { results: [] };
        },
      }),
    },
  });
  const get = (path, e = env(), method = 'GET') => worker.fetch(new Request(`https://api.test${path}`, { method }), e, {});

  afterEach(() => vi.restoreAllMocks());

  test('returns curated links for an indexed post', async () => {
    const res = await get('/api/v1/posts/101/docs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.postId).toBe(101);
    expect(body.docs[0]).toMatchObject({ title: 'CORS (MDN)', url: 'https://developer.mozilla.org/ko/docs/Web/HTTP/Guides/CORS' });
  });

  test('unknown or unindexed post is 404', async () => {
    const res = await get('/api/v1/posts/999/docs', env({ post: null }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('POST_NOT_FOUND');
  });

  test('non-numeric id is not routed', async () => {
    expect((await get('/api/v1/posts/abc/docs')).status).toBe(404);
  });

  test('POST is not allowed', async () => {
    expect((await get('/api/v1/posts/101/docs', env(), 'POST')).status).toBe(405);
  });

  test('backend failure returns a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/v1/posts/101/docs', env({ fail: true }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('internal detail');
  });
});
