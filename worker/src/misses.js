// Zero-result search log (migrations/0003_search_misses.sql). Stores only the normalized question.
export const RETENTION_DAYS = 90;
const TOP_LIMIT = 50;

/** Best effort: a logging failure must never fail the search itself. */
export async function recordMiss(env, normalizedQuery) {
  try {
    await env.DB.prepare('INSERT INTO search_misses (query) VALUES (?)').bind(normalizedQuery).run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'record_miss_failed', error: String(error) }));
  }
}

export async function purgeOldMisses(env) {
  await env.DB.prepare(`DELETE FROM search_misses WHERE created_at < datetime('now', ?)`)
    .bind(`-${RETENTION_DAYS} days`)
    .run();
}

/** Most frequent unanswered questions in the last `days` days. */
export async function topMisses(env, days) {
  const { results } = await env.DB.prepare(
    `SELECT query, count(*) AS count, max(created_at) AS last_seen FROM search_misses
     WHERE created_at >= datetime('now', ?) GROUP BY query ORDER BY count DESC, last_seen DESC LIMIT ?`,
  ).bind(`-${days} days`, TOP_LIMIT).all();
  return results;
}
