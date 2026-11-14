import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { ANSWER_MODEL } from '../src/answer.js';
import { backfillSummaries, parseSummary, summarizePost } from '../src/summary.js';

afterEach(() => vi.restoreAllMocks());

describe('parseSummary', () => {
  test('three lines, bullets and numbering stripped', () => {
    expect(parseSummary('- useEffect는 렌더링 후 실행된다.\n• 빈 배열이면 처음 한 번만 실행된다.\n3. 정리 함수로 뒷정리를 한다.\n')).toEqual([
      'useEffect는 렌더링 후 실행된다.',
      '빈 배열이면 처음 한 번만 실행된다.',
      '정리 함수로 뒷정리를 한다.',
    ]);
  });

  test('extra lines are dropped and long lines cut', () => {
    expect(parseSummary(`- a\n- b\n- c\n- d`)).toEqual(['a', 'b', 'c']);
    expect(parseSummary(`- ${'가'.repeat(300)}\n- b`)[0]).toHaveLength(120);
  });

  test('fewer than two lines or nothing is not a summary', () => {
    expect(parseSummary('- 한 줄뿐')).toBeNull();
    expect(parseSummary('')).toBeNull();
    expect(parseSummary(undefined)).toBeNull();
  });
});

describe('summarizePost', () => {
  test('asks the answer model (thinking off) for 3 lines from the post text only', async () => {
    const run = vi.fn(async () => ({ response: '- 하나.\n- 둘.\n- 셋.' }));
    expect(await summarizePost({ AI: { run } }, '[React] 7. useEffect', 'useEffect\n렌더링마다 실행')).toEqual(['하나.', '둘.', '셋.']);
    const [model, input] = run.mock.calls[0];
    expect(model).toBe(ANSWER_MODEL);
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(input.messages.at(-1).content).toContain('제목: [React] 7. useEffect');
    expect(input.messages.at(-1).content).toContain('렌더링마다 실행');
  });

  test('a model failure gives no summary instead of an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const run = async () => {
      throw new Error('quota');
    };
    expect(await summarizePost({ AI: { run } }, 't', 'x')).toBeNull();
  });
});

describe('backfillSummaries', () => {
  test('summarizes indexed posts that have none, a few at a time, and reports what is left', async () => {
    const updates = [];
    const env = {
      AI: { run: async () => ({ response: '- 하나.\n- 둘.\n- 셋.' }) },
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            all: async () => {
              if (sql.includes('LIMIT')) return { results: [{ id: 98, title: 'useEffect' }] };
              if (sql.includes('FROM post_chunks')) return { results: [{ heading: 'useEffect', text: '본문' }] };
              return { results: [] };
            },
            first: async () => ({ n: 4 }),
            run: async () => {
              updates.push({ sql, args });
            },
          }),
        }),
      },
    };
    expect(await backfillSummaries(env, 1)).toEqual({ done: 1, remaining: 4 });
    expect(updates).toEqual([{ sql: expect.stringContaining('UPDATE posts SET ai_summary'), args: ['["하나.","둘.","셋."]', 98] }]);
  });
});

describe('GET /api/v1/posts/:id/summary', () => {
  const env = (row) => ({ DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } });
  const get = (e) => worker.fetch(new Request('https://api.test/api/v1/posts/98/summary'), e, {});

  test('returns the stored lines', async () => {
    const res = await get(env({ ai_summary: '["하나.","둘."]' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ postId: 98, summary: ['하나.', '둘.'] });
  });

  test('null while not generated yet, 404 for an unknown post', async () => {
    expect((await (await get(env({ ai_summary: null }))).json()).summary).toBeNull();
    expect((await get(env(null))).status).toBe(404);
  });
});
