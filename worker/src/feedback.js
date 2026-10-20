// 👍/👎 on search results (migrations/0004_search_feedback.sql). Stores only the normalized question,
// the vote and the shown post ids.
import { RETENTION_DAYS } from './misses.js';
import { MAX_QUERY_CHARS, normalizeQuery } from './search/query.js';
import { RESULT_LIMIT } from './search/search.js';

const MAX_BODY_BYTES = 1024;
const TOP_LIMIT = 50;
const VOTES = new Set(['up', 'down']);

/** {"query", "vote": "up"|"down", "postIds": [1-3 post ids]} -> normalized feedback, or null when invalid. */
export async function readFeedback(request) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    const { query, vote, postIds } = JSON.parse(body);
    if (typeof query !== 'string' || !VOTES.has(vote) || !Array.isArray(postIds)) return null;
    const normalized = normalizeQuery(query);
    if (!normalized || normalized.length > MAX_QUERY_CHARS) return null;
    if (postIds.length < 1 || postIds.length > RESULT_LIMIT) return null;
    if (!postIds.every((id) => Number.isInteger(id) && id > 0 && id < 1e9)) return null;
    return { query: normalized, vote, postIds };
  } catch {
    return null;
  }
}

export async function recordFeedback(env, { query, vote, postIds }) {
  await env.DB.prepare('INSERT INTO search_feedback (query, vote, post_ids) VALUES (?, ?, ?)')
    .bind(query, vote, JSON.stringify(postIds))
    .run();
}

export async function purgeOldFeedback(env) {
  await env.DB.prepare(`DELETE FROM search_feedback WHERE created_at < datetime('now', ?)`)
    .bind(`-${RETENTION_DAYS} days`)
    .run();
}

/** Vote totals and the most down-voted questions in the last `days` days. */
export async function feedbackReport(env, days) {
  const since = `-${days} days`;
  const totals = await env.DB.prepare(
    `SELECT vote, count(*) AS count FROM search_feedback WHERE created_at >= datetime('now', ?) GROUP BY vote`,
  ).bind(since).all();
  // post_ids of the latest row per query (SQLite returns the bare column from the max() row).
  const queries = await env.DB.prepare(
    `SELECT query, sum(vote = 'down') AS down, sum(vote = 'up') AS up, post_ids AS last_post_ids, max(created_at) AS last_seen
     FROM search_feedback WHERE created_at >= datetime('now', ?)
     GROUP BY query ORDER BY down DESC, last_seen DESC LIMIT ?`,
  ).bind(since, TOP_LIMIT).all();
  return {
    totals: Object.fromEntries(['up', 'down'].map((vote) => [vote, totals.results.find((row) => row.vote === vote)?.count ?? 0])),
    queries: queries.results.map(({ last_post_ids: ids, ...row }) => ({ ...row, lastPostIds: JSON.parse(ids) })),
  };
}
