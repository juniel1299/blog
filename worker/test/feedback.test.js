import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';

const TOKEN = 'a'.repeat(48);

/** D1 stand-in: records INSERT args; summary/top queries return fixed rows. */
function env({ insertFails = false } = {}) {
  const inserted = [];
  return {
    inserted,
    ADMIN_TOKEN: TOKEN,
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          run: async () => {
            if (insertFails) throw new Error('d1 down');
            inserted.push(args);
          },
          all: async () => {
            if (sql.includes('GROUP BY vote')) return { results: [{ vote: 'up', count: 5 }, { vote: 'down', count: 2 }] };
            return { results: [{ query: 'react', down: 2, up: 1, last_post_ids: '[98,99]', last_seen: 'x' }] };
          },
        }),
      }),
    },
  };
}

const post = (body, e = env()) =>
  worker.fetch(
    new Request('https://api.test/api/v1/feedback', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
    e,
    {},
  );

afterEach(() => vi.restoreAllMocks());

describe('POST /api/v1/feedback', () => {
  test('stores the normalized query, vote and shown post ids', async () => {
    const e = env();
    const res = await post({ query: '  React   상태관리 ', vote: 'down', postIds: [98, 99, 110] }, e);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(e.inserted).toEqual([['react 상태관리', 'down', '[98,99,110]']]);
  });

  test.each([
    ['bad vote', { query: 'q', vote: 'meh', postIds: [1] }],
    ['empty query', { query: ' ', vote: 'up', postIds: [1] }],
    ['long query', { query: 'x'.repeat(201), vote: 'up', postIds: [1] }],
    ['no posts', { query: 'q', vote: 'up', postIds: [] }],
    ['too many posts', { query: 'q', vote: 'up', postIds: [1, 2, 3, 4] }],
    ['non-integer id', { query: 'q', vote: 'up', postIds: ['1'] }],
    ['not json', '{'],
  ])('rejects %s', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_FEEDBACK');
  });

  test('GET is not allowed', async () => {
    const res = await worker.fetch(new Request('https://api.test/api/v1/feedback'), env(), {});
    expect(res.status).toBe(405);
  });

  test('a storage failure is a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ query: 'q', vote: 'up', postIds: [1] }, env({ insertFails: true }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('d1 down');
  });
});

describe('GET /admin/feedback', () => {
  const get = (path) => worker.fetch(new Request(`https://api.test${path}`, { headers: { authorization: `Bearer ${TOKEN}` } }), env(), {});

  test('returns vote totals and the most down-voted queries', async () => {
    const res = await get('/admin/feedback?days=7');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      days: 7,
      totals: { up: 5, down: 2 },
      queries: [{ query: 'react', down: 2, up: 1, lastPostIds: [98, 99] }],
    });
  });

  test.each(['0', '91', 'x'])('rejects days=%s', async (days) => {
    expect((await get(`/admin/feedback?days=${days}`)).status).toBe(400);
  });
});
