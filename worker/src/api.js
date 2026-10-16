import { relatedDocs } from './docs.js';
import { errorBody, json } from './http.js';
import { MAX_QUERY_CHARS } from './search/query.js';
import { searchPosts } from './search/search.js';

const MAX_BODY_BYTES = 2048;
const CACHE_SECONDS = 600;
const SEARCH_PATH = '/api/v1/search';
const DOCS_PATH = /^\/api\/v1\/posts\/(\d{1,9})\/docs$/;

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

async function handleDocs(env, postId, requestId, headers) {
  try {
    const docs = await relatedDocs(env, postId);
    if (docs === null) return json(errorBody('POST_NOT_FOUND', '글을 찾을 수 없어요.', requestId), 404, headers);
    return json({ postId, docs, requestId }, 200, { ...headers, 'cache-control': `public, max-age=${CACHE_SECONDS}` });
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: 'docs_failed', postId, error: String(error) }));
    return json(errorBody('DOCS_FAILED', '관련 문서를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', requestId), 500, headers);
  }
}

/**
 * Public chat API (docs/api-contract.md):
 *   POST /api/v1/search              -> { query, results: [...] }
 *   GET  /api/v1/posts/:postId/docs  -> { postId, docs: [...] }
 * Returns null for other paths so the main router can continue.
 */
export async function handleApi(request, env, ctx, { pathname }, requestId, headers) {
  const docsMatch = pathname.match(DOCS_PATH);
  if (pathname !== SEARCH_PATH && !docsMatch) return null;
  const method = docsMatch ? 'GET' : 'POST';
  if (request.method !== method) {
    return json(errorBody('METHOD_NOT_ALLOWED', `Use ${method}`, requestId), 405, { ...headers, allow: method });
  }

  if (env.SEARCH_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.SEARCH_LIMITER.limit({ key: ip });
    if (!success) return json(errorBody('RATE_LIMITED', '잠시 후 다시 시도해 주세요.', requestId), 429, headers);
  }

  if (docsMatch) return handleDocs(env, Number(docsMatch[1]), requestId, headers);

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
