import { errorBody, json } from './http.js';
import { MAX_QUERY_CHARS } from './search/query.js';
import { searchPosts } from './search/search.js';

const MAX_BODY_BYTES = 2048;
const CACHE_SECONDS = 600;

function cacheKey(query) {
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
  return new Request(`https://search-cache.internal/v1?q=${encodeURIComponent(normalized)}`);
}

/** Reads {"query": string} with a size cap; returns the trimmed query or null when invalid. */
async function readQuery(request) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    const { query } = JSON.parse(body);
    if (typeof query !== 'string') return null;
    const trimmed = query.trim();
    return trimmed.length >= 1 && trimmed.length <= MAX_QUERY_CHARS ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Public chat API. POST /api/v1/search -> { query, results: [...] } (docs/api-contract.md).
 * Returns null for other paths so the main router can continue.
 */
export async function handleApi(request, env, ctx, { pathname }, requestId, headers) {
  if (pathname !== '/api/v1/search') return null;
  if (request.method !== 'POST') {
    return json(errorBody('METHOD_NOT_ALLOWED', 'Use POST', requestId), 405, { ...headers, allow: 'POST' });
  }

  if (env.SEARCH_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.SEARCH_LIMITER.limit({ key: ip });
    if (!success) return json(errorBody('RATE_LIMITED', '잠시 후 다시 시도해 주세요.', requestId), 429, headers);
  }

  const query = await readQuery(request);
  if (!query) {
    return json(errorBody('INVALID_QUERY', `query는 1~${MAX_QUERY_CHARS}자 문자열이어야 합니다.`, requestId), 400, headers);
  }

  const cache = globalThis.caches?.default;
  const key = cacheKey(query);
  try {
    const cached = await cache?.match(key);
    if (cached) return json({ ...(await cached.json()), requestId }, 200, headers);

    const body = { query, results: await searchPosts(env, query) };
    ctx?.waitUntil(
      cache?.put(key, new Response(JSON.stringify(body), { headers: { 'cache-control': `max-age=${CACHE_SECONDS}` } })),
    );
    return json({ ...body, requestId }, 200, headers);
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: 'search_failed', error: String(error) }));
    return json(errorBody('SEARCH_FAILED', '검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', requestId), 500, headers);
  }
}
