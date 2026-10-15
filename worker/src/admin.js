import { errorBody, json } from './http.js';
import { readPost, runIngest } from './ingest/run.js';
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
