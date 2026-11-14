import { describe, expect, test } from 'vitest';
import worker from '../src/index.js';
import { assistDraft } from '../src/assist.js';

const TOKEN = 'a'.repeat(48);
const POSTS = [
  { id: 97, title: '[React] 6. 생명주기', url: 'https://b/97', category: 'JavaScript/React', tags: '["react","리액트","lifecycle"]' },
  { id: 98, title: '[React] 7. useEffect', url: 'https://b/98', category: 'JavaScript/React', tags: '["react","useEffect","리액트"]' },
  { id: 99, title: '[React] 8. useReducer', url: 'https://b/99', category: 'JavaScript/React', tags: '["React","useReducer"]' },
  { id: 122, title: 'Index 란?', url: 'https://b/122', category: 'SQL(oracle)', tags: '["index"]' },
];
const DOCS = [{ id: 1, technology: 'react', title: 'useEffect', url: 'https://react.dev/useEffect', description: null, keywords: '["useeffect","react"]' }];

function env() {
  return {
    ADMIN_TOKEN: TOKEN,
    AI: { run: async (_model, { text }) => ({ data: text.map(() => [0.1, 0.2]) }) },
    VECTORIZE: {
      query: async () => ({
        matches: [
          { id: '98-0', score: 0.81 },
          { id: '98-3', score: 0.7 },
          { id: '99-1', score: 0.66 },
          { id: '97-0', score: 0.58 },
          { id: '122-0', score: 0.41 },
        ],
      }),
    },
    DB: {
      prepare: (sql) => ({
        bind: () => ({ all: async () => ({ results: [] }) }),
        all: async () => ({ results: sql.includes('FROM doc_links') ? DOCS : POSTS }),
      }),
    },
  };
}

describe('assistDraft', () => {
  test('related posts, category, tags, series with the next episode, and docs', async () => {
    const result = await assistDraft(env(), { title: '[React] 커스텀 훅 만들기', text: 'useEffect 와 useState 로 훅을 만든다' });
    expect(result.related).toEqual([
      { postId: 98, title: '[React] 7. useEffect', url: 'https://b/98', score: 0.81 },
      { postId: 99, title: '[React] 8. useReducer', url: 'https://b/99', score: 0.66 },
      { postId: 97, title: '[React] 6. 생명주기', url: 'https://b/97', score: 0.58 },
    ]);
    expect(result.category).toBe('JavaScript/React');
    expect(result.tags.slice(0, 2)).toEqual(['react', '리액트']);
    expect(result.series).toEqual({ name: 'React', count: 3, nextOrder: 9, last: { title: '[React] 8. useReducer', url: 'https://b/99' } });
    expect(result.docs.map((d) => d.title)).toContain('useEffect');
  });

  test('nothing close and no series prefix: empty suggestions', async () => {
    const e = env();
    e.VECTORIZE.query = async () => ({ matches: [{ id: '122-0', score: 0.3 }] });
    const result = await assistDraft(e, { title: '여행 일기', text: '제주도' });
    expect(result).toMatchObject({ related: [], category: null, tags: [], series: null });
  });
});

describe('POST /admin/assist', () => {
  const post = (body, token = TOKEN) =>
    worker.fetch(
      new Request('https://api.test/admin/assist', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
      env(),
      {},
    );

  test('returns suggestions for a draft', async () => {
    const res = await post({ title: '[React] 커스텀 훅', text: '본문' });
    expect(res.status).toBe(200);
    expect((await res.json()).related.length).toBe(3);
  });

  test.each([
    ['no title', { text: 'x' }],
    ['long title', { title: 'a'.repeat(201), text: '' }],
    ['huge body', { title: 't', text: 'a'.repeat(20001) }],
  ])('rejects %s', async (_name, body) => {
    expect((await post(body)).status).toBe(400);
  });

  test('hidden without the token', async () => {
    expect((await post({ title: 't', text: '' }, 'b'.repeat(48))).status).toBe(404);
  });
});
