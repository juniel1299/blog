import { answerQuestion } from './answer.js';
import { relatedDocs } from './docs.js';
import { readFeedback, recordFeedback } from './feedback.js';
import { errorBody, json } from './http.js';
import { recordMiss } from './misses.js';
import { recentPosts, seriesPosts, similarPosts } from './posts.js';
import { extractCategory, isRecentRequest } from './search/intent.js';
import { MAX_QUERY_CHARS, normalizeQuery } from './search/query.js';
import { RESULT_LIMIT, RESULT_POOL, searchPosts } from './search/search.js';

const MAX_BODY_BYTES = 2048;
const CACHE_SECONDS = 600;
const PUBLIC_CACHE = { 'cache-control': `public, max-age=${CACHE_SECONDS}` };
const SEARCH_PATH = '/api/v1/search';
const RECENT_PATH = '/api/v1/posts/recent';
const FEEDBACK_PATH = '/api/v1/feedback';
const ANSWER_PATH = '/api/v1/answer';
const POST_METHOD_PATHS = new Set([SEARCH_PATH, FEEDBACK_PATH, ANSWER_PATH]);
const POST_PATH = /^\/api\/v1\/posts\/(\d{1,9})\/(docs|similar|series)$/;

function cacheKey(normalized, kind = 'v2') {
  return new Request(`https://search-cache.internal/${kind}?q=${encodeURIComponent(normalized)}`);
}

/**
 * Reads {"query": string, "offset"?: 0 | 3} with a size cap. offset pages through the RESULT_POOL
 * in steps of RESULT_LIMIT ("더 보기"). Returns null when invalid.
 */
async function readSearchBody(request) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return null;
  try {
    const { query, offset = 0 } = JSON.parse(body);
    if (typeof query !== 'string') return null;
    const trimmed = query.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_QUERY_CHARS) return null;
    if (!Number.isInteger(offset) || offset < 0 || offset >= RESULT_POOL || offset % RESULT_LIMIT !== 0) return null;
    return { query: trimmed, offset };
  } catch {
    return null;
  }
}

/** Full result pool for a chat message: recent-posts request, category-scoped search, or plain search. */
async function answer(env, query) {
  if (isRecentRequest(query)) return { mode: 'recent', category: null, results: await recentPosts(env, { limit: RESULT_POOL }) };
  const { category, rest } = extractCategory(query);
  if (category) return { mode: 'category', category, results: await searchPosts(env, rest, { category }) };
  return { mode: 'search', category: null, results: await searchPosts(env, query) };
}

async function handleSearch(request, env, ctx, requestId, headers) {
  const input = await readSearchBody(request);
  if (!input) {
    return json(
      errorBody('INVALID_QUERY', `query는 1~${MAX_QUERY_CHARS}자 문자열, offset은 0 또는 ${RESULT_LIMIT}이어야 합니다.`, requestId),
      400,
      headers,
    );
  }
  const { query, offset } = input;
  const cache = globalThis.caches?.default;
  const normalized = normalizeQuery(query);
  const key = cacheKey(normalized);
  try {
    // The whole pool is cached, so "더 보기" (offset 3) is served without searching again.
    let pool = await (await cache?.match(key))?.json();
    if (!pool) {
      pool = await answer(env, query);
      ctx?.waitUntil(cache?.put(key, new Response(JSON.stringify(pool), { headers: { 'cache-control': `max-age=${CACHE_SECONDS}` } })));
      // Cached repeats within 10 minutes aren't re-logged, so counts are "distinct-ish" asks.
      if (pool.results.length === 0 && pool.mode !== 'recent') ctx?.waitUntil(recordMiss(env, normalized));
    }
    const results = pool.results.slice(offset, offset + RESULT_LIMIT);
    const hasMore = offset + RESULT_LIMIT < pool.results.length;
    return json({ query, mode: pool.mode, category: pool.category, offset, results, hasMore, requestId }, 200, headers);
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: 'search_failed', error: String(error) }));
    return json(errorBody('SEARCH_FAILED', '검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', requestId), 500, headers);
  }
}

/** Grounded answer for a question; 503 when the model is unavailable so the widget falls back to search. */
async function handleAnswer(request, env, ctx, requestId, headers) {
  const input = await readSearchBody(request);
  if (!input) return json(errorBody('INVALID_QUERY', `query는 1~${MAX_QUERY_CHARS}자 문자열이어야 합니다.`, requestId), 400, headers);
  const cache = globalThis.caches?.default;
  const key = cacheKey(normalizeQuery(input.query), 'answer-v1');
  try {
    let body = await (await cache?.match(key))?.json();
    if (!body) {
      body = await answerQuestion(env, input.query);
      ctx?.waitUntil(cache?.put(key, new Response(JSON.stringify(body), { headers: { 'cache-control': `max-age=${CACHE_SECONDS}` } })));
    }
    return json({ query: input.query, ...body, requestId }, 200, headers);
  } catch (error) {
    // Includes Workers AI's daily free allocation running out.
    console.error(JSON.stringify({ requestId, event: 'answer_failed', error: String(error) }));
    return json(errorBody('ANSWER_UNAVAILABLE', '지금은 답변을 만들 수 없어요. 검색 결과로 보여드릴게요.', requestId), 503, headers);
  }
}

async function handlePost(env, postId, kind, requestId, headers) {
  try {
    if (kind === 'docs') {
      const docs = await relatedDocs(env, postId);
      if (docs === null) return json(errorBody('POST_NOT_FOUND', '글을 찾을 수 없어요.', requestId), 404, headers);
      return json({ postId, docs, requestId }, 200, { ...headers, ...PUBLIC_CACHE });
    }
    if (kind === 'series') {
      const series = await seriesPosts(env, postId);
      if (series === undefined) return json(errorBody('POST_NOT_FOUND', '글을 찾을 수 없어요.', requestId), 404, headers);
      return json({ postId, series, requestId }, 200, { ...headers, ...PUBLIC_CACHE });
    }
    const posts = await similarPosts(env, postId, RESULT_LIMIT);
    if (posts === null) return json(errorBody('POST_NOT_FOUND', '글을 찾을 수 없어요.', requestId), 404, headers);
    return json({ postId, posts, requestId }, 200, { ...headers, ...PUBLIC_CACHE });
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: `${kind}_failed`, postId, error: String(error) }));
    return json(errorBody(`${kind.toUpperCase()}_FAILED`, '불러오지 못했어요. 잠시 후 다시 시도해 주세요.', requestId), 500, headers);
  }
}

async function handleFeedback(request, env, requestId, headers) {
  const feedback = await readFeedback(request);
  if (!feedback) {
    return json(errorBody('INVALID_FEEDBACK', 'query, vote(up|down), postIds(1~3개 글 번호)가 필요합니다.', requestId), 400, headers);
  }
  try {
    await recordFeedback(env, feedback);
    return json({ ok: true, requestId }, 200, headers);
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: 'feedback_failed', error: String(error) }));
    return json(errorBody('FEEDBACK_FAILED', '피드백을 저장하지 못했어요.', requestId), 500, headers);
  }
}

async function handleRecent(env, requestId, headers) {
  try {
    return json({ posts: await recentPosts(env, { limit: RESULT_LIMIT }), requestId }, 200, { ...headers, ...PUBLIC_CACHE });
  } catch (error) {
    console.error(JSON.stringify({ requestId, event: 'recent_failed', error: String(error) }));
    return json(errorBody('RECENT_FAILED', '최근 글을 불러오지 못했어요.', requestId), 500, headers);
  }
}

/**
 * Public chat API (docs/api-contract.md):
 *   POST /api/v1/search                 -> { query, mode, category, offset, results, hasMore }
 *   GET  /api/v1/posts/recent           -> { posts }
 *   GET  /api/v1/posts/:postId/docs     -> { postId, docs }
 *   GET  /api/v1/posts/:postId/similar  -> { postId, posts }
 *   GET  /api/v1/posts/:postId/series   -> { postId, series }
 *   POST /api/v1/feedback               -> { ok }
 *   POST /api/v1/answer                 -> { query, answer, sources }
 * Returns null for other paths so the main router can continue.
 */
export async function handleApi(request, env, ctx, { pathname }, requestId, headers) {
  const postMatch = pathname.match(POST_PATH);
  if (!POST_METHOD_PATHS.has(pathname) && pathname !== RECENT_PATH && !postMatch) return null;
  const method = POST_METHOD_PATHS.has(pathname) ? 'POST' : 'GET';
  if (request.method !== method) {
    return json(errorBody('METHOD_NOT_ALLOWED', `Use ${method}`, requestId), 405, { ...headers, allow: method });
  }

  if (env.SEARCH_LIMITER) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const { success } = await env.SEARCH_LIMITER.limit({ key: ip });
    if (!success) return json(errorBody('RATE_LIMITED', '잠시 후 다시 시도해 주세요.', requestId), 429, headers);
  }

  if (postMatch) return handlePost(env, Number(postMatch[1]), postMatch[2], requestId, headers);
  if (pathname === RECENT_PATH) return handleRecent(env, requestId, headers);
  if (pathname === FEEDBACK_PATH) return handleFeedback(request, env, requestId, headers);
  if (pathname === ANSWER_PATH) return handleAnswer(request, env, ctx, requestId, headers);
  return handleSearch(request, env, ctx, requestId, headers);
}
