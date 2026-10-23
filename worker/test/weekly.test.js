import { afterEach, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { ANSWER_MODEL } from '../src/answer.js';
import { WEEKLY_CRON, buildAndPublish, buildWeekly, weekKey } from '../src/weekly.js';

const TOKEN = 'a'.repeat(48);

describe('weekKey (Monday of the week, Korean time)', () => {
  test.each([
    ['2026-10-26T00:00:00Z', '2026-10-26'], // the cron: Monday 09:00 KST
    ['2026-10-25T14:59:00Z', '2026-10-19'], // Sunday 23:59 KST -> previous Monday
    ['2026-10-25T15:00:00Z', '2026-10-26'], // Monday 00:00 KST
    ['2026-10-29T03:00:00Z', '2026-10-26'], // Thursday
  ])('%s -> %s', (iso, expected) => {
    expect(weekKey(new Date(iso))).toBe(expected);
  });
});

const REPORT = {
  days: 7,
  summary: { views: 120, avgSeconds: 70, avgDepth: 55, readThroughRate: 0.4, questions: 30, answers: 9, misses: 4, clicks: 21, up: 3, down: 1 },
  daily: [],
  posts: [{ postId: 98, title: '[React] 7. useEffect', url: 'https://b/98', views: 40, prevViews: 20, change: 20, avgSeconds: 90, readRate: 0.5, chatClicks: 3 }],
  rising: [{ postId: 98, title: '[React] 7. useEffect', url: 'https://b/98', views: 40, prevViews: 20, change: 20, avgSeconds: 90, readRate: 0.5, chatClicks: 3 }],
  sources: [{ source: 'naver', n: 70 }],
  referrers: [],
  keywords: [{ query: 'useEffect 빈 배열', engine: 'naver', n: 9 }],
  questions: [{ query: '리액트 상태관리', count: 6, answers: 0, clicks: 4, clickRate: 0.67 }],
  clickSources: [],
  misses: [],
  disliked: [],
};
const TOPICS = {
  topics: [{ label: '리액트 상태관리', count: 6, examples: ['리액트 상태관리'], kinds: { asked: 6, miss: 0, disliked: 0, lowClick: 0 } }],
  gaps: [{ label: '쿠버네티스 배포', count: 3, examples: ['쿠버네티스 배포'], kinds: { asked: 0, miss: 3, disliked: 0, lowClick: 0 }, type: 'new', nearest: null }],
};

function env({ llm = async () => ({ response: '이번 주 조회는 120회였어요. 다음 주에는 쿠버네티스 글을 써 보세요.' }) } = {}) {
  const stored = [];
  return {
    stored,
    ADMIN_TOKEN: TOKEN,
    AI: { run: vi.fn(async (model, input) => (model === ANSWER_MODEL ? llm(input) : null)) },
    DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          run: async () => {
            if (sql.includes('INSERT INTO weekly_insights')) stored.push(args);
          },
          first: async () => null,
          all: async () => ({
            results: sql.includes('FROM weekly_insights')
              ? [{ week: '2026-10-26', summary: '요약', report: JSON.stringify({ summary: { views: 1 } }), created_at: 'x' }]
              : [],
          }),
        }),
      }),
    },
  };
}

const loaders = { insights: async () => REPORT, topicReport: async () => TOPICS };

afterEach(() => vi.restoreAllMocks());

describe('buildWeekly', () => {
  test('asks the model to explain the numbers and stores the week with a compact report', async () => {
    const e = env();
    const week = await buildWeekly(e, new Date('2026-10-26T00:00:00Z'), loaders);
    expect(week.week).toBe('2026-10-26');
    expect(week.summary).toBe('이번 주 조회는 120회였어요. 다음 주에는 쿠버네티스 글을 써 보세요.');

    const [, input] = e.AI.run.mock.calls[0];
    const prompt = input.messages.at(-1).content;
    expect(prompt).toContain('"views":120');
    expect(prompt).toContain('쿠버네티스 배포');
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false });

    const [weekArg, summaryArg, reportArg] = e.stored[0];
    expect([weekArg, summaryArg]).toEqual(['2026-10-26', week.summary]);
    const report = JSON.parse(reportArg);
    expect(report.summary.views).toBe(120);
    expect(report.gaps[0]).toMatchObject({ label: '쿠버네티스 배포', type: 'new' });
    expect(report.sources).toEqual([{ source: '네이버', n: 70 }]);
  });

  test('a model failure still stores the numbers, with no summary text', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const llm = async () => {
      throw new Error('quota');
    };
    const e = env({ llm });
    const week = await buildWeekly(e, new Date('2026-10-26T00:00:00Z'), loaders);
    expect(week.summary).toBeNull();
    expect(e.stored[0][1]).toBeNull();
  });

  test('a week with no visits and no questions gets a plain sentence without calling the model', async () => {
    const e = env();
    const quiet = {
      insights: async () => ({ ...REPORT, summary: { ...REPORT.summary, views: 0, questions: 0 } }),
      topicReport: async () => ({ topics: [], gaps: [] }),
    };
    const week = await buildWeekly(e, new Date('2026-10-26T00:00:00Z'), quiet);
    expect(week.summary).toBe('이번 주에는 기록된 방문과 질문이 없어요.');
    expect(e.AI.run).not.toHaveBeenCalled();
  });
});

describe('buildAndPublish', () => {
  const NOW = new Date('2026-10-26T00:00:00Z');

  test('without Notion settings the week is stored and Notion is skipped', async () => {
    const e = env();
    const week = await buildAndPublish(e, NOW, loaders, vi.fn());
    expect(week.notion).toEqual({ skipped: true });
    expect(e.stored).toHaveLength(1);
  });

  test('a Notion failure is reported but the week stays stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = { ...env(), NOTION_TOKEN: 'ntn_test', NOTION_PARENT_PAGE_ID: 'parent' };
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    const week = await buildAndPublish(e, NOW, loaders, fetchImpl);
    expect(week.notion).toEqual({ error: '노션으로 보내지 못했어요.' });
    expect(e.stored).toHaveLength(1);
  });
});

describe('weekly cron and admin API', () => {
  test('the Monday cron builds the weekly insight and skips the ingest run', async () => {
    const e = env();
    const waits = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await worker.scheduled({ cron: WEEKLY_CRON }, e, { waitUntil: (p) => waits.push(p) });
    await Promise.allSettled(waits);
    expect(waits).toHaveLength(1);
  });

  test('GET /admin/weekly lists stored weeks with parsed reports', async () => {
    const res = await worker.fetch(new Request('https://api.test/admin/weekly', { headers: { authorization: `Bearer ${TOKEN}` } }), env(), {});
    expect(res.status).toBe(200);
    expect((await res.json()).weeks).toEqual([{ week: '2026-10-26', summary: '요약', report: { summary: { views: 1 } }, notionUrl: null, createdAt: 'x' }]);
  });

  test('without the token the weekly API is hidden', async () => {
    const res = await worker.fetch(new Request('https://api.test/admin/weekly', { method: 'POST' }), env(), {});
    expect(res.status).toBe(404);
  });
});
