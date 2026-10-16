import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';

/** D1 stand-in for the search path: FTS returns `ftsIds`; records INSERTs into search_misses. */
function env({ ftsIds = [], insertFails = false } = {}) {
  const inserted = [];
  const rows = { '1-0': { chunk_id: '1-0', heading: null, text: '본문 문장입니다 충분히 길게', post_id: 1, title: 'T', url: 'https://b/1', category: null } };
  return {
    inserted,
    ADMIN_TOKEN: 'a'.repeat(48),
    AI: { run: async () => ({ data: [[0.1]] }) },
    VECTORIZE: { query: async () => ({ matches: [] }) },
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          all: async () => {
            if (sql.includes('MATCH')) return { results: ftsIds.map((chunk_id) => ({ chunk_id })) };
            if (sql.includes('WHERE c.id IN')) return { results: args.map((id) => rows[id]).filter(Boolean) };
            if (sql.includes('FROM search_misses')) return { results: [{ query: 'q', count: 2, last_seen: 'x' }] };
            return { results: [] };
          },
          run: async () => {
            if (insertFails) throw new Error('d1 down');
            inserted.push(args[0]);
          },
        }),
      }),
    },
  };
}

async function search(query, e) {
  const pending = [];
  const res = await worker.fetch(
    new Request('https://api.test/api/v1/search', { method: 'POST', body: JSON.stringify({ query }) }),
    e,
    { waitUntil: (p) => pending.push(p) },
  );
  await Promise.all(pending);
  return res;
}

afterEach(() => vi.restoreAllMocks());

describe('zero-result logging', () => {
  test('records the normalized question when nothing is found', async () => {
    const e = env();
    const res = await search('  김치찌개   레시피 ', e);
    expect((await res.json()).results).toEqual([]);
    expect(e.inserted).toEqual(['김치찌개 레시피']);
  });

  test('does not record when results exist', async () => {
    const e = env({ ftsIds: ['1-0'] });
    await search('문장입니다', e); // 3+ chars so it takes the FTS path the mock answers
    expect(e.inserted).toEqual([]);
  });

  test('a logging failure does not fail the search', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await search('없는 주제', env({ insertFails: true }));
    expect(res.status).toBe(200);
  });
});

describe('GET /admin/misses', () => {
  const get = (path, e = env()) =>
    worker.fetch(new Request(`https://api.test${path}`, { headers: { authorization: `Bearer ${'a'.repeat(48)}` } }), e, {});

  test('returns the top unanswered questions', async () => {
    const res = await get('/admin/misses?days=7');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ days: 7, misses: [{ query: 'q', count: 2 }] });
  });

  test.each(['0', '91', 'abc', '1.5'])('rejects days=%s', async (days) => {
    expect((await get(`/admin/misses?days=${days}`)).status).toBe(400);
  });
});
