// Weekly insight: the past 7 days' numbers plus a short Korean summary written by Workers AI, stored per
// week (migrations/0006_weekly_insights.sql). Made by the Monday cron or POST /admin/weekly.
import { ANSWER_MODEL } from './answer.js';
import { insights } from './insights.js';
import { topicReport } from './topics.js';

// Cloudflare cron is UTC: Monday 00:00 UTC = Monday 09:00 KST. Must match wrangler.jsonc.
export const WEEKLY_CRON = '0 0 * * MON';
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 600;
const HISTORY_LIMIT = 12;
const QUIET = '이번 주에는 기록된 방문과 질문이 없어요.';
const SOURCE_LABELS = {
  direct: '직접 방문',
  internal: '블로그 안 이동',
  naver: '네이버',
  daum: '다음',
  google: '구글',
  bing: '빙',
  zum: '줌',
  duckduckgo: '덕덕고',
  other: '다른 사이트',
};

const SYSTEM = `너는 개발 블로그 '주니엘의 개발일지'의 데이터 분석가야. 주어진 JSON의 숫자만 근거로 한국어 3~5문장으로 지난 7일을 정리해.
- 조회 흐름, 많이 읽힌/급상승한 글, 유입 경로나 검색어에서 눈에 띄는 점을 짚어.
- 마지막 문장은 다음 주에 할 일 하나를 제안해 (gaps의 "다음 글 후보"가 있으면 그중 하나).
- JSON에 없는 숫자나 사실은 지어내지 마. 목록이나 마크다운 없이 문장으로만 써.`;

/** "YYYY-MM-DD" of the Monday (Korean time) of the week containing `now`. */
export function weekKey(now) {
  const kst = new Date(now.getTime() + KST_MS);
  const sinceMonday = (kst.getUTCDay() + 6) % 7;
  return new Date(kst.getTime() - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The part of the 7-day report worth keeping and showing the model. */
function compactReport(report, topics) {
  const post = ({ title, views, change, readRate }) => ({ title, views, change, readRate });
  return {
    summary: report.summary,
    topPosts: report.posts.slice(0, 5).map(post),
    rising: report.rising.slice(0, 3).map(post),
    sources: report.sources.slice(0, 5).map(({ source, n }) => ({ source: SOURCE_LABELS[source] ?? source, n })),
    keywords: report.keywords.slice(0, 5).map(({ query, n }) => ({ query, n })),
    questions: report.questions.slice(0, 5).map(({ query, count, clickRate }) => ({ query, count, clickRate })),
    topics: topics.topics.slice(0, 5).map(({ label, count }) => ({ label, count })),
    gaps: topics.gaps.slice(0, 5).map(({ label, count, type, nearest }) => ({
      label,
      count,
      type,
      typeLabel: type === 'new' ? '새 글 후보' : '기존 글 보강',
      ...(nearest?.title ? { nearestPost: nearest.title } : {}),
    })),
  };
}

async function summarize(env, compact) {
  if (compact.summary.views === 0 && compact.summary.questions === 0) return QUIET;
  try {
    const out = await env.AI.run(ANSWER_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: JSON.stringify(compact) },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      chat_template_kwargs: { enable_thinking: false },
    });
    return (out?.response ?? out?.choices?.[0]?.message?.content ?? '').trim() || null;
  } catch (error) {
    // Includes the daily free allocation running out: the numbers are still stored.
    console.error(JSON.stringify({ event: 'weekly_summary_failed', error: String(error) }));
    return null;
  }
}

/**
 * Builds and stores (upserts) the insight for the week containing `now`.
 * @returns {Promise<{ week: string, summary: string | null, report: object }>}
 */
export async function buildWeekly(env, now = new Date(), loaders = { insights, topicReport }) {
  const [report, topics] = await Promise.all([loaders.insights(env, 7), loaders.topicReport(env, 7)]);
  const compact = compactReport(report, topics);
  const summary = await summarize(env, compact);
  const week = weekKey(now);
  await env.DB.prepare(
    `INSERT INTO weekly_insights (week, summary, report) VALUES (?, ?, ?)
     ON CONFLICT(week) DO UPDATE SET summary = excluded.summary, report = excluded.report, created_at = datetime('now')`,
  ).bind(week, summary, JSON.stringify(compact)).run();
  return { week, summary, report: compact };
}

/** Latest weeks first. */
export async function listWeekly(env, limit = HISTORY_LIMIT) {
  const { results } = await env.DB.prepare('SELECT week, summary, report, created_at FROM weekly_insights ORDER BY week DESC LIMIT ?')
    .bind(limit)
    .all();
  return results.map((row) => ({ week: row.week, summary: row.summary, report: JSON.parse(row.report), createdAt: row.created_at }));
}
