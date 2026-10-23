// Weekly insight -> a Notion page (one child page per week under NOTION_PARENT_PAGE_ID). Rebuilding a week
// rewrites the same page so its link stays the same. Needs secrets NOTION_TOKEN and NOTION_PARENT_PAGE_ID.
export const NOTION_VERSION = '2026-03-11';
const API = 'https://api.notion.com/v1';
const MAX_TEXT = 2000; // Notion's per rich-text limit

const rt = (content, url) => ({
  type: 'text',
  text: { content: String(content).slice(0, MAX_TEXT), ...(/^https?:\/\//.test(url ?? '') ? { link: { url } } : {}) },
});
const block = (type, richText, extra = {}) => ({ object: 'block', type, [type]: { rich_text: richText, ...extra } });
const heading = (text) => block('heading_2', [rt(text)]);
const bullet = (...parts) => block('bulleted_list_item', parts);
const paragraph = (...parts) => block('paragraph', parts);
const percent = (value) => `${Math.round((value ?? 0) * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));

function list(title, items, toBullet) {
  return [heading(title), ...(items.length ? items.map(toBullet) : [paragraph(rt('없음'))])];
}

/** Page content for one stored week ({ week, summary, report } from weekly.js). */
export function weeklyBlocks({ summary, report }, dashboardUrl) {
  const s = report.summary;
  const postBullet = (p) => bullet(rt(p.title, p.url), rt(` · ${p.views}회 (${signed(p.change)})`));
  return [
    block('callout', [rt(summary ?? 'AI 요약을 만들지 못했어요. 아래 숫자를 확인해 주세요.')], { icon: { type: 'emoji', emoji: '💡' } }),
    heading('숫자'),
    bullet(rt(`조회 ${s.views} · 평균 ${s.avgSeconds}초 · 끝까지 읽음 ${percent(s.readThroughRate)}`)),
    bullet(rt(`챗봇 질문 ${s.questions} (AI 답변 ${s.answers}) · 카드 클릭 ${s.clicks} · 결과 0건 ${s.misses} · 👍 ${s.up} / 👎 ${s.down}`)),
    ...list('많이 읽힌 글', report.topPosts, postBullet),
    ...list('급상승 글', report.rising, postBullet),
    ...list('유입 경로', report.sources, (x) => bullet(rt(`${x.source} ${x.n}`))),
    ...list('검색어', report.keywords, (k) => bullet(rt(`${k.query} · ${k.n}회`))),
    ...list('많이 묻는 질문', report.questions, (q) => bullet(rt(`${q.query} · ${q.count}회 · 클릭률 ${percent(q.clickRate)}`))),
    ...list('다음 글 후보', report.gaps, (g) =>
      bullet(rt(`${g.label} · ${g.typeLabel} · 질문 ${g.count}회${g.nearestPost ? ` · 가까운 글: ${g.nearestPost}` : ''}`)),
    ),
    paragraph(rt('대시보드에서 자세히 보기', dashboardUrl)),
  ];
}

async function call(env, fetchImpl, method, path, body) {
  return fetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.NOTION_TOKEN}`, 'notion-version': NOTION_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Error with Notion's own code/message (e.g. object_not_found: page not shared with the integration). Never the token. */
async function fail(method, path, res) {
  const body = await res.json().catch(() => ({}));
  const detail = [body.code, body.message].filter(Boolean).join(': ').slice(0, 300);
  return new Error(`Notion ${method} ${path} failed: HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
}
const titleProperty = (week) => ({ title: { title: [rt(`${week} 주간 인사이트`)] } });

/** Clears and refills an existing page. null when the page is gone (deleted in Notion). */
async function rewrite(env, fetchImpl, pageId, week, children) {
  const path = `/pages/${pageId}`;
  const res = await call(env, fetchImpl, 'PATCH', path, { erase_content: true, properties: titleProperty(week) });
  if (res.status === 404) return null;
  if (!res.ok) throw await fail('PATCH', path, res);
  const page = await res.json();
  const append = await call(env, fetchImpl, 'PATCH', `/blocks/${pageId}/children`, { children });
  if (!append.ok) throw await fail('PATCH', `/blocks/${pageId}/children`, append);
  return { id: page.id ?? pageId, url: page.url };
}

async function create(env, fetchImpl, week, children) {
  const res = await call(env, fetchImpl, 'POST', '/pages', {
    parent: { page_id: env.NOTION_PARENT_PAGE_ID },
    icon: { type: 'emoji', emoji: '📊' },
    properties: titleProperty(week),
    children,
  });
  if (!res.ok) throw await fail('POST', '/pages', res);
  const page = await res.json();
  return { id: page.id, url: page.url };
}

/**
 * Sends a stored week to Notion and remembers the page. Throws on Notion errors (callers log them).
 * @returns {Promise<{ skipped: true } | { pageId: string, url: string }>}
 */
export async function pushWeekly(env, week, fetchImpl = fetch) {
  if (!env.NOTION_TOKEN || !env.NOTION_PARENT_PAGE_ID) return { skipped: true };
  const children = weeklyBlocks(week, env.DASHBOARD_URL);
  const existing = (await env.DB.prepare('SELECT notion_page_id FROM weekly_insights WHERE week = ?').bind(week.week).first())
    ?.notion_page_id;
  const page = (existing && (await rewrite(env, fetchImpl, existing, week.week, children))) || (await create(env, fetchImpl, week.week, children));
  await env.DB.prepare('UPDATE weekly_insights SET notion_page_id = ?, notion_url = ? WHERE week = ?').bind(page.id, page.url, week.week).run();
  return { pageId: page.id, url: page.url };
}
