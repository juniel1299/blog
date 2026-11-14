import { errorBody, json } from './http.js';
import { feedbackReport } from './feedback.js';
import { syncSearchConsole } from './gsc.js';
import { assistDraft } from './assist.js';
import { insights } from './insights.js';
import { backfillSummaries } from './summary.js';
import { topicReport } from './topics.js';
import { buildAndPublish, listWeekly } from './weekly.js';
import { readPost, runIngest } from './ingest/run.js';
import { RETENTION_DAYS, topMisses } from './misses.js';
import { similarScores } from './posts.js';
import { MAX_QUERY_CHARS } from './search/query.js';
import { debugRankings } from './search/search.js';

const MIN_TOKEN_LENGTH = 32;

/** Equal-length strings compared without early exit, so response time doesn't leak the token. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const token = env.ADMIN_TOKEN ?? '';
  if (token.length < MIN_TOKEN_LENGTH) return false; // admin API is off until a strong secret is set
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') && safeEqual(header.slice(7), token);
}

const MAX_DRAFT_TITLE = 200;
const MAX_DRAFT_TEXT = 20000;

/** {"title", "text"} for the writing helper, or null when invalid. */
async function readDraft(request) {
  try {
    const { title, text = '' } = JSON.parse(await request.text());
    if (typeof title !== 'string' || typeof text !== 'string') return null;
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > MAX_DRAFT_TITLE || text.length > MAX_DRAFT_TEXT) return null;
    return { title: trimmed, text };
  } catch {
    return null;
  }
}

/**
 * Admin routes: POST /admin/ingest (run one sync pass now), GET /admin/preview?id=<postId> (parse only).
 * Returns null for non-admin paths so the main router can continue.
 */
export async function handleAdmin(request, env, { pathname, searchParams }, requestId, headers) {
  if (!pathname.startsWith('/admin/')) return null;
  // 404 (not 401) when unauthorized: don't advertise that the admin API exists.
  if (!authorized(request, env)) return json(errorBody('NOT_FOUND', 'Not found', requestId), 404, headers);

  try {
    if (request.method === 'POST' && pathname === '/admin/ingest') {
      return json({ ...(await runIngest(env)), requestId }, 200, headers);
    }
    if (request.method === 'GET' && pathname === '/admin/preview') {
      const id = searchParams.get('id') ?? '';
      if (!/^\d{1,9}$/.test(id)) return json(errorBody('INVALID_ID', 'id must be a post number', requestId), 400, headers);
      return json({ ...(await readPost({ url: `${env.BLOG_ORIGIN}/${id}` })), requestId }, 200, headers);
    }
    if (request.method === 'GET' && pathname === '/admin/similar-debug') {
      const id = searchParams.get('id') ?? '';
      if (!/^\d{1,9}$/.test(id)) return json(errorBody('INVALID_ID', 'id must be a post number', requestId), 400, headers);
      const scores = await similarScores(env, Number(id));
      return json({ id: Number(id), scores: scores?.slice(0, 10) ?? null, requestId }, 200, headers);
    }
    if (request.method === 'POST' && pathname === '/admin/assist') {
      const draft = await readDraft(request);
      if (!draft) return json(errorBody('INVALID_DRAFT', 'title 1-200 chars, text up to 20000 chars', requestId), 400, headers);
      return json({ ...(await assistDraft(env, draft)), requestId }, 200, headers);
    }
    if (request.method === 'POST' && pathname === '/admin/summaries') {
      const limit = Number(searchParams.get('limit') ?? 5);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) return json(errorBody('INVALID_LIMIT', 'limit must be 1-20', requestId), 400, headers);
      return json({ ...(await backfillSummaries(env, limit)), requestId }, 200, headers);
    }
    if (request.method === 'POST' && pathname === '/admin/gsc/sync') {
      return json({ ...(await syncSearchConsole(env)), requestId }, 200, headers);
    }
    if (request.method === 'GET' && pathname === '/admin/weekly') {
      return json({ weeks: await listWeekly(env), requestId }, 200, { ...headers, 'cache-control': 'no-store' });
    }
    if (request.method === 'POST' && pathname === '/admin/weekly') {
      return json({ ...(await buildAndPublish(env)), requestId }, 200, headers);
    }
    if (request.method === 'GET' && ['/admin/misses', '/admin/feedback', '/admin/insights', '/admin/insights/topics'].includes(pathname)) {
      const days = Number(searchParams.get('days') ?? 30);
      if (!Number.isInteger(days) || days < 1 || days > RETENTION_DAYS) {
        return json(errorBody('INVALID_DAYS', `days must be 1-${RETENTION_DAYS}`, requestId), 400, headers);
      }
      if (pathname === '/admin/feedback') return json({ days, ...(await feedbackReport(env, days)), requestId }, 200, headers);
      if (pathname === '/admin/insights/topics') {
        return json({ days, ...(await topicReport(env, days)), requestId }, 200, { ...headers, 'cache-control': 'no-store' });
      }
      if (pathname === '/admin/insights') {
        return json({ ...(await insights(env, days)), requestId }, 200, { ...headers, 'cache-control': 'no-store' });
      }
      return json({ days, misses: await topMisses(env, days), requestId }, 200, headers);
    }
    if (request.method === 'GET' && pathname === '/admin/search-debug') {
      const q = (searchParams.get('q') ?? '').trim();
      if (!q || q.length > MAX_QUERY_CHARS) return json(errorBody('INVALID_QUERY', 'q is required', requestId), 400, headers);
      return json({ ...(await debugRankings(env, q)), requestId }, 200, headers);
    }
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: 'admin_failed', path: pathname, error: String(error) }));
    return json(errorBody('ADMIN_FAILED', 'Admin operation failed', requestId), 500, headers);
  }
  return json(errorBody('NOT_FOUND', 'Not found', requestId), 404, headers);
}
