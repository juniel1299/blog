import { afterEach, describe, expect, test, vi } from 'vitest';
import { NOTION_VERSION, pushWeekly, weeklyBlocks } from '../src/notion.js';

const WEEK = {
  week: '2026-10-26',
  summary: '이번 주 조회는 120회였어요. 다음 주에는 쿠버네티스 글을 써 보세요.',
  report: {
    summary: { views: 120, avgSeconds: 70, avgDepth: 55, readThroughRate: 0.4, questions: 30, answers: 9, misses: 4, clicks: 21, up: 3, down: 1 },
    topPosts: [{ title: '[React] 7. useEffect', url: 'https://b/98', views: 40, change: 20, readRate: 0.5 }],
    rising: [{ title: '[React] 7. useEffect', url: 'https://b/98', views: 40, change: 20, readRate: 0.5 }],
    sources: [{ source: '네이버', n: 70 }],
    keywords: [{ query: 'useEffect 빈 배열', n: 9 }],
    questions: [{ query: '리액트 상태관리', count: 6, clickRate: 0.67 }],
    topics: [{ label: '리액트 상태관리', count: 6 }],
    gaps: [{ label: '쿠버네티스 배포', count: 3, type: 'new', typeLabel: '새 글 후보' }],
  },
};

const text = (block) => block[block.type].rich_text.map((t) => t.text.content).join('');

describe('weeklyBlocks', () => {
  test('summary callout, numbers, posts, sources, keywords, gaps and a dashboard link', () => {
    const blocks = weeklyBlocks(WEEK, 'https://api/dashboard/');
    expect(blocks[0]).toMatchObject({ type: 'callout', callout: { icon: { type: 'emoji', emoji: '💡' } } });
    expect(text(blocks[0])).toBe(WEEK.summary);

    const all = blocks.map((b) => `${b.type}:${b[b.type].rich_text ? text(b) : ''}`);
    expect(all).toContain('heading_2:다음 글 후보');
    expect(all).toContain('bulleted_list_item:쿠버네티스 배포 · 새 글 후보 · 질문 3회');
    expect(all.some((line) => line.startsWith('bulleted_list_item:조회 120'))).toBe(true);

    const post = blocks.find((b) => b.type === 'bulleted_list_item' && text(b).startsWith('[React] 7. useEffect'));
    expect(post.bulleted_list_item.rich_text[0].text.link).toEqual({ url: 'https://b/98' });
    expect(text(post)).toBe('[React] 7. useEffect · 40회 (+20)');
    expect(blocks.at(-1).paragraph.rich_text[0].text.link).toEqual({ url: 'https://api/dashboard/' });
  });

  test('no AI summary and empty lists still give a readable page', () => {
    const blocks = weeklyBlocks({ ...WEEK, summary: null, report: { ...WEEK.report, topPosts: [], rising: [], gaps: [] } }, 'https://api/dashboard/');
    expect(text(blocks[0])).toBe('AI 요약을 만들지 못했어요. 아래 숫자를 확인해 주세요.');
    expect(blocks.some((b) => b.type === 'paragraph' && text(b) === '없음')).toBe(true);
  });

  test("rich text is cut at Notion's 2000-character limit", () => {
    const blocks = weeklyBlocks({ ...WEEK, summary: '가'.repeat(2500) }, 'https://api/dashboard/');
    expect(text(blocks[0])).toHaveLength(2000);
  });
});

describe('pushWeekly', () => {
  function env({ pageId = null, configured = true } = {}) {
    const updates = [];
    return {
      updates,
      ...(configured ? { NOTION_TOKEN: 'ntn_test', NOTION_PARENT_PAGE_ID: 'parent-123' } : {}),
      DASHBOARD_URL: 'https://api/dashboard/',
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            first: async () => (sql.includes('SELECT notion_page_id') ? { notion_page_id: pageId } : null),
            run: async () => {
              if (sql.includes('UPDATE weekly_insights')) updates.push(args);
            },
          }),
        }),
      },
    };
  }
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

  afterEach(() => vi.restoreAllMocks());

  test('not configured: does nothing', async () => {
    const fetchImpl = vi.fn();
    expect(await pushWeekly(env({ configured: false }), WEEK, fetchImpl)).toEqual({ skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('first push creates a child page under the parent page and remembers it', async () => {
    const e = env();
    const fetchImpl = vi.fn(async () => ok({ id: 'page-1', url: 'https://www.notion.so/page-1' }));
    expect(await pushWeekly(e, WEEK, fetchImpl)).toEqual({ pageId: 'page-1', url: 'https://www.notion.so/page-1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/pages');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer ntn_test', 'notion-version': NOTION_VERSION, 'content-type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(body.parent).toEqual({ page_id: 'parent-123' });
    expect(body.properties.title.title[0].text.content).toBe('2026-10-26 주간 인사이트');
    expect(body.children.length).toBeGreaterThan(5);
    expect(e.updates).toEqual([['page-1', 'https://www.notion.so/page-1', '2026-10-26']]);
  });

  test('rebuilding the same week rewrites the same page (same link)', async () => {
    const e = env({ pageId: 'page-1' });
    const fetchImpl = vi.fn(async () => ok({ id: 'page-1', url: 'https://www.notion.so/page-1' }));
    await pushWeekly(e, WEEK, fetchImpl);
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'PATCH https://api.notion.com/v1/pages/page-1',
      'PATCH https://api.notion.com/v1/blocks/page-1/children',
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ erase_content: true });
  });

  test('a page deleted in Notion (404) is created again', async () => {
    const e = env({ pageId: 'gone' });
    const fetchImpl = vi.fn(async (url) =>
      url.includes('/pages/gone') ? new Response('{}', { status: 404 }) : ok({ id: 'page-2', url: 'https://www.notion.so/page-2' }),
    );
    expect(await pushWeekly(e, WEEK, fetchImpl)).toEqual({ pageId: 'page-2', url: 'https://www.notion.so/page-2' });
    expect(fetchImpl.mock.calls.at(-1)[0]).toBe('https://api.notion.com/v1/pages');
  });

  test('other Notion errors throw with the status, without the token', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"unauthorized"}', { status: 401 }));
    const error = await pushWeekly(env(), WEEK, fetchImpl).catch((e) => e);
    expect(String(error)).toContain('401');
    expect(String(error)).not.toContain('ntn_test');
  });
});
