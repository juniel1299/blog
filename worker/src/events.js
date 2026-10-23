// Visitor analytics for the insight dashboard (migrations/0005_analytics.sql). Nothing here identifies
// a visitor: no IP, user agent or cookie; referrers keep only the host and search-engine words.
import { RETENTION_DAYS } from './misses.js';
import { MAX_QUERY_CHARS, normalizeQuery } from './search/query.js';
import { RESULT_POOL } from './search/search.js';

const MAX_BODY_BYTES = 2048;
const MAX_PATH_CHARS = 200;
const MAX_REFERRER_CHARS = 1000;
const MAX_SEARCH_WORDS = 100;
const MAX_SECONDS = 24 * 60 * 60;
const DEPTHS = new Set([0, 25, 50, 75, 100]);
const SOURCES = new Set(['chat', 'answer', 'list', 'header']);
// Host pattern -> [engine, query parameter]. Google hides the search words, so it only counts as an engine.
const ENGINES = [
  [/(^|\.)naver\.com$/, 'naver', 'query'],
  [/(^|\.)daum\.net$/, 'daum', 'q'],
  [/(^|\.)google\.[a-z.]+$/, 'google', 'q'],
  [/(^|\.)bing\.com$/, 'bing', 'q'],
  [/(^|\.)zum\.com$/, 'zum', 'query'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo', 'q'],
];

/** Referrer URL -> { host ("internal" for this blog), search engine, search words }. Never the full URL. */
export function parseReferrer(referrer, blogOrigin) {
  const none = { host: null, engine: null, query: null };
  if (!referrer) return none;
  let url;
  try {
    url = new URL(referrer);
  } catch {
    return none;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return none;
  if (blogOrigin && url.host === new URL(blogOrigin).host) return { host: 'internal', engine: null, query: null };
  const match = ENGINES.find(([pattern]) => pattern.test(url.hostname));
  const words = match ? url.searchParams.get(match[2])?.trim().replace(/\s+/g, ' ') : null;
  return { host: url.host, engine: match?.[1] ?? null, query: words ? words.slice(0, MAX_SEARCH_WORDS) : null };
}

const isPostId = (value) => Number.isInteger(value) && value > 0 && value < 1e9;

function readView({ path, postId = null, referrer = '', depth, seconds }) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAX_PATH_CHARS) return null;
  if (postId !== null && !isPostId(postId)) return null;
  if (typeof referrer !== 'string' || referrer.length > MAX_REFERRER_CHARS) return null;
  if (!DEPTHS.has(depth) || !Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SECONDS) return null;
  return { type: 'view', path, postId, referrer, depth, seconds };
}

function readClick({ postId, position, source, query = null }) {
  if (!isPostId(postId) || !SOURCES.has(source)) return null;
  if (!Number.isInteger(position) || position < 1 || position > RESULT_POOL) return null;
  if (query !== null && (typeof query !== 'string' || query.length > MAX_QUERY_CHARS)) return null;
  const normalized = query === null ? null : normalizeQuery(query) || null;
  return { type: 'click', postId, position, source, query: normalized };
}

/** Beacon body (text/plain JSON) -> validated event, or null. */
export async function readEvent(request) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    const event = JSON.parse(body);
    if (event?.type === 'view') return readView(event);
    if (event?.type === 'click') return readClick(event);
    return null;
  } catch {
    return null;
  }
}

export async function recordEvent(env, event) {
  if (event.type === 'view') {
    const ref = parseReferrer(event.referrer, env.BLOG_ORIGIN);
    await env.DB.prepare(
      'INSERT INTO page_views (path, post_id, referrer_host, search_engine, search_query, depth, seconds) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(event.path, event.postId, ref.host, ref.engine, ref.query, event.depth, event.seconds).run();
    return;
  }
  await env.DB.prepare('INSERT INTO result_clicks (post_id, position, source, query) VALUES (?, ?, ?, ?)')
    .bind(event.postId, event.position, event.source, event.query)
    .run();
}

/** Chat questions that found posts (zero-result ones go to search_misses instead). Best effort. */
export async function recordQuery(env, normalizedQuery, mode, postIds) {
  try {
    await env.DB.prepare('INSERT INTO search_queries (query, mode, post_ids) VALUES (?, ?, ?)')
      .bind(normalizedQuery, mode, JSON.stringify(postIds))
      .run();
  } catch (error) {
    console.error(JSON.stringify({ event: 'record_query_failed', error: String(error) }));
  }
}

export async function purgeOldEvents(env) {
  const cutoff = `-${RETENTION_DAYS} days`;
  for (const table of ['page_views', 'result_clicks', 'search_queries']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE created_at < datetime('now', ?)`).bind(cutoff).run();
  }
}
