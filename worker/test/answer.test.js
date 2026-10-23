import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { ANSWER_MODEL, NOT_FOUND, cleanAnswer, postContext } from '../src/answer.js';
import { EMBEDDING_MODEL } from '../src/ingest/run.js';

describe('cleanAnswer', () => {
  test('keeps citations that point at a source and drops the rest', () => {
    expect(cleanAnswer(' 인덱스는 빠르다 [1]. 단점도 있다 [2][5].\n', 3)).toEqual({
      answer: '인덱스는 빠르다 [1]. 단점도 있다 [2].',
      cited: [1, 2],
    });
  });

  test('"not found" or empty output means no answer', () => {
    expect(cleanAnswer(NOT_FOUND, 3)).toBeNull();
    expect(cleanAnswer(`  ${NOT_FOUND}  `, 3)).toBeNull();
    expect(cleanAnswer('', 3)).toBeNull();
    expect(cleanAnswer(undefined, 3)).toBeNull();
  });
});

describe('postContext', () => {
  const chunks = [
    { position: 0, heading: '인덱스란 ?', text: 'a'.repeat(10) },
    { position: 1, heading: '단점 ?', text: '느려짐' },
    { position: 2, heading: '유의 사항', text: 'b'.repeat(2000) },
  ];

  test('starts at the matched heading and stops at the size cap', () => {
    const text = postContext(chunks, '단점 ?', 100);
    expect(text.startsWith('단점 ?\n느려짐')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(100);
  });

  test('unknown heading starts from the top', () => {
    expect(postContext(chunks, null, 30).startsWith('인덱스란 ?')).toBe(true);
  });
});

describe('POST /api/v1/answer', () => {
  const rows = {
    '122-1': { chunk_id: '122-1', heading: '단점 ?', text: 'insert 가 느려짐', post_id: 122, title: 'Index 란?', url: 'https://b/122', category: 'SQL(oracle)' },
  };
  const postChunks = [
    { post_id: 122, position: 0, heading: '인덱스란 ?', text: '빠르게 찾는 도구' },
    { post_id: 122, position: 1, heading: '단점 ?', text: 'insert, update, delete 가 오히려 느려짐' },
  ];

  function env({ ftsIds = ['122-1'], llm = async () => ({ response: '쓰기 작업이 느려져요 [1].' }) } = {}) {
    const logged = [];
    return {
      logged,
      AI: {
        run: vi.fn(async (model, input) => (model === EMBEDDING_MODEL ? { data: [[0.1]] } : llm(input))),
      },
      VECTORIZE: { query: async () => ({ matches: [] }) },
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            run: async () => {
              logged.push(args);
            },
            all: async () => {
              if (sql.includes('MATCH')) return { results: ftsIds.map((chunk_id) => ({ chunk_id })) };
              if (sql.includes('WHERE c.id IN')) return { results: args.map((id) => rows[id]).filter(Boolean) };
              if (sql.includes('post_id IN')) return { results: postChunks.filter((c) => args.includes(c.post_id)) };
              return { results: [] };
            },
          }),
        }),
      },
    };
  }

  const ask = async (body, e = env()) => {
    const pending = [];
    const res = await worker.fetch(
      new Request('https://api.test/api/v1/answer', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }),
      e,
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    return res;
  };

  afterEach(() => vi.restoreAllMocks());

  test('answers from the found posts and marks which ones were cited', async () => {
    const e = env();
    const res = await ask({ query: '인덱스가 많으면 왜 안 좋아?' }, e);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.answer).toBe('쓰기 작업이 느려져요 [1].');
    expect(body.sources).toEqual([
      expect.objectContaining({ postId: 122, title: 'Index 란?', url: 'https://b/122', cited: true }),
    ]);

    const [, input] = e.AI.run.mock.calls.find(([m]) => m === ANSWER_MODEL);
    expect(input.messages.at(-1).content).toContain('[출처 1] Index 란?');
    expect(input.messages.at(-1).content).toContain('insert, update, delete 가 오히려 느려짐');
    expect(input.messages.at(-1).content).toContain('질문: 인덱스가 많으면 왜 안 좋아?');
  });

  test('no matching posts: no answer and the model is not called', async () => {
    const e = env({ ftsIds: [] });
    const body = await (await ask({ query: '쿠버네티스 배포 방법' }, e)).json();
    expect(body).toMatchObject({ answer: null, sources: [] });
    expect(e.AI.run.mock.calls.some(([m]) => m === ANSWER_MODEL)).toBe(false);
    expect(e.logged).toEqual([]);
  });

  test('a question that found posts is logged for the dashboard', async () => {
    const e = env();
    await ask({ query: '  인덱스가 많으면   왜 안 좋아? ' }, e);
    expect(e.logged).toEqual([['인덱스가 많으면 왜 안 좋아?', 'answer', '[122]']]);
  });

  test('model says the posts do not answer it: no answer, sources still listed', async () => {
    const body = await (await ask({ query: '인덱스 역사?' }, env({ llm: async () => ({ response: NOT_FOUND }) }))).json();
    expect(body.answer).toBeNull();
    expect(body.sources.map((s) => s.postId)).toEqual([122]);
  });

  test('model failure (e.g. free quota used up) is a 503 so the widget falls back to search', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const llm = async () => {
      throw new Error('4006: daily free allocation used');
    };
    const res = await ask({ query: '인덱스?' }, env({ llm }));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain('ANSWER_UNAVAILABLE');
    expect(text).not.toContain('4006');
  });

  test('invalid question is a 400', async () => {
    expect((await ask({ query: ' ' })).status).toBe(400);
    expect((await ask('{')).status).toBe(400);
  });
});
