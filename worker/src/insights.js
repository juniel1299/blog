// Insight dashboard report (GET /admin/insights): visits, entry paths and chat questions for a period,
// with posts compared to the period before. Reads only the anonymous tables from migration 0005 plus
// the existing zero-result and feedback logs.
import { feedbackReport } from './feedback.js';
import { topMisses } from './misses.js';

const LIST_LIMIT = 20;
const RISING_LIMIT = 5;
const MIN_RISING_VIEWS = 2; // a single visit is noise, not a trend
// Dates are grouped in Korean time.
const KST = '+9 hours';

const round = (value, digits = 0) => Number((value ?? 0).toFixed(digits));
const rate = (part, whole) => (whole ? round(part / whole, 2) : 0);

const SQL = {
  summary: `/* summary */ SELECT
    (SELECT count(*) FROM page_views WHERE created_at >= datetime('now', ?1)) AS views,
    (SELECT count(*) FROM page_views WHERE created_at >= datetime('now', ?1) AND post_id IS NOT NULL) AS post_views,
    (SELECT avg(seconds) FROM page_views WHERE created_at >= datetime('now', ?1)) AS avg_seconds,
    (SELECT avg(depth) FROM page_views WHERE created_at >= datetime('now', ?1) AND post_id IS NOT NULL) AS avg_depth,
    (SELECT sum(depth >= 75) FROM page_views WHERE created_at >= datetime('now', ?1) AND post_id IS NOT NULL) AS read_through,
    (SELECT count(*) FROM search_queries WHERE created_at >= datetime('now', ?1)) AS questions,
    (SELECT sum(mode = 'answer') FROM search_queries WHERE created_at >= datetime('now', ?1)) AS answers,
    (SELECT count(*) FROM result_clicks WHERE created_at >= datetime('now', ?1)) AS clicks`,
  daily: `/* daily */ SELECT date(created_at, '${KST}') AS day, count(*) AS views
    FROM page_views WHERE created_at >= datetime('now', ?1) GROUP BY day ORDER BY day`,
  posts: `/* posts */ SELECT v.post_id, p.title, p.url, count(*) AS views, avg(v.seconds) AS avg_seconds,
      avg(v.depth >= 75) AS read_rate
    FROM page_views v LEFT JOIN posts p ON p.id = v.post_id
    WHERE v.created_at >= datetime('now', ?1) AND v.post_id IS NOT NULL
    GROUP BY v.post_id ORDER BY views DESC LIMIT ${LIST_LIMIT * 2}`,
  prev: `/* prev */ SELECT post_id, count(*) AS views FROM page_views
    WHERE created_at >= datetime('now', ?2) AND created_at < datetime('now', ?1) AND post_id IS NOT NULL
    GROUP BY post_id`,
  post_clicks: `/* post_clicks */ SELECT post_id, count(*) AS clicks FROM result_clicks
    WHERE created_at >= datetime('now', ?1) GROUP BY post_id`,
  sources: `/* sources */ SELECT CASE
        WHEN referrer_host IS NULL THEN 'direct'
        WHEN referrer_host = 'internal' THEN 'internal'
        WHEN search_engine IS NOT NULL THEN search_engine
        ELSE 'other' END AS source, count(*) AS n
    FROM page_views WHERE created_at >= datetime('now', ?1) GROUP BY source ORDER BY n DESC`,
  referrers: `/* referrers */ SELECT referrer_host AS host, count(*) AS n FROM page_views
    WHERE created_at >= datetime('now', ?1) AND referrer_host IS NOT NULL AND referrer_host != 'internal'
      AND search_engine IS NULL
    GROUP BY host ORDER BY n DESC LIMIT ${LIST_LIMIT}`,
  keywords: `/* keywords */ SELECT search_query AS query, search_engine AS engine, count(*) AS n FROM page_views
    WHERE created_at >= datetime('now', ?1) AND search_query IS NOT NULL
    GROUP BY query, engine ORDER BY n DESC LIMIT ${LIST_LIMIT}`,
  questions: `/* questions */ SELECT query, count(*) AS n, sum(mode = 'answer') AS answers FROM search_queries
    WHERE created_at >= datetime('now', ?1) GROUP BY query ORDER BY n DESC LIMIT ${LIST_LIMIT}`,
  query_clicks: `/* query_clicks */ SELECT query, count(*) AS clicks FROM result_clicks
    WHERE created_at >= datetime('now', ?1) AND query IS NOT NULL GROUP BY query`,
  click_sources: `/* click_sources */ SELECT source, count(*) AS n FROM result_clicks
    WHERE created_at >= datetime('now', ?1) GROUP BY source ORDER BY n DESC`,
};

function shapePosts(rows, prevRows, clickRows) {
  const prev = new Map(prevRows.map((row) => [row.post_id, row.views]));
  const clicks = new Map(clickRows.map((row) => [row.post_id, row.clicks]));
  return rows.map((row) => {
    const prevViews = prev.get(row.post_id) ?? 0;
    return {
      postId: row.post_id,
      title: row.title ?? `(삭제되었거나 색인 전인 글 #${row.post_id})`,
      url: row.url,
      views: row.views,
      prevViews,
      change: row.views - prevViews,
      avgSeconds: round(row.avg_seconds),
      readRate: round(row.read_rate, 2),
      chatClicks: clicks.get(row.post_id) ?? 0,
    };
  });
}

/**
 * @param {number} days period length (1-90); the previous period of the same length is the comparison
 */
export async function insights(env, days) {
  const now = `-${days} days`;
  const before = `-${days * 2} days`;
  // Bind only the parameters each query uses: SQLite rejects extra bindings.
  const all = (sql, ...args) => env.DB.prepare(sql).bind(...(args.length ? args : [now])).all().then((r) => r.results);
  const [summary, daily, posts, prev, postClicks, sources, referrers, keywords, questions, queryClicks, clickSources, misses, feedback] =
    await Promise.all([
      env.DB.prepare(SQL.summary).bind(now).first(),
      all(SQL.daily),
      all(SQL.posts),
      all(SQL.prev, now, before),
      all(SQL.post_clicks),
      all(SQL.sources),
      all(SQL.referrers),
      all(SQL.keywords),
      all(SQL.questions),
      all(SQL.query_clicks),
      all(SQL.click_sources),
      topMisses(env, days),
      feedbackReport(env, days),
    ]);

  const postList = shapePosts(posts, prev, postClicks);
  const clicksByQuery = new Map(queryClicks.map((row) => [row.query, row.clicks]));
  const s = summary ?? {};
  return {
    days,
    summary: {
      views: s.views ?? 0,
      avgSeconds: round(s.avg_seconds),
      avgDepth: round(s.avg_depth),
      readThroughRate: rate(s.read_through ?? 0, s.post_views),
      questions: s.questions ?? 0,
      answers: s.answers ?? 0,
      misses: misses.reduce((sum, row) => sum + row.count, 0),
      clicks: s.clicks ?? 0,
      up: feedback.totals.up,
      down: feedback.totals.down,
    },
    daily,
    posts: postList.slice(0, LIST_LIMIT),
    rising: postList
      .filter((post) => post.views >= MIN_RISING_VIEWS && post.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, RISING_LIMIT),
    sources,
    referrers,
    keywords,
    questions: questions.map((row) => {
      const clicks = clicksByQuery.get(row.query) ?? 0;
      return { query: row.query, count: row.n, answers: row.answers ?? 0, clicks, clickRate: rate(clicks, row.n) };
    }),
    clickSources,
    misses: misses.slice(0, LIST_LIMIT).map(({ query, count }) => ({ query, count })),
    disliked: feedback.queries
      .filter((row) => row.down > 0)
      .slice(0, LIST_LIMIT)
      .map(({ query, down, up }) => ({ query, down, up })),
  };
}
