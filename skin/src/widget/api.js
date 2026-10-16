export const MAX_QUERY_CHARS = 200;
const TIMEOUT_MS = 15000;

/** Thrown with a user-facing Korean message; `kind` lets the UI pick a tone. */
export class SearchError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Links come from our own index, but never render anything that isn't http(s) as a link. */
export function isSafeUrl(url) {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** fetch with a timeout and user-facing errors for network/429/non-2xx; returns the parsed JSON body. */
async function requestJson(url, init, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new SearchError('network', '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 429) throw new SearchError('rate', '질문이 너무 많아요. 잠시 후 다시 시도해 주세요.');
  if (!response.ok) throw new SearchError('server', '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  return response.json().catch(() => ({}));
}

const apiUrl = (apiBase, path) => `${apiBase.replace(/\/+$/, '')}${path}`;

/**
 * @param {string} apiBase e.g. https://tistory-ai-assistant-api.<sub>.workers.dev
 * @param {string} query
 * @returns {Promise<{ postId: number, title: string, url: string, category: string | null, heading: string | null, preview: string }[]>}
 */
export async function searchBlog(apiBase, query, { fetchImpl = fetch } = {}) {
  const body = await requestJson(
    apiUrl(apiBase, '/api/v1/search'),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) },
    fetchImpl,
  );
  if (!Array.isArray(body.results)) throw new SearchError('server', '검색 결과를 읽지 못했어요.');
  return body.results.filter((result) => typeof result.title === 'string' && isSafeUrl(result.url));
}

/**
 * Curated official doc links for one post.
 * @returns {Promise<{ technology: string, title: string, url: string, description: string | null }[]>}
 */
export async function fetchDocs(apiBase, postId, { fetchImpl = fetch } = {}) {
  const body = await requestJson(apiUrl(apiBase, `/api/v1/posts/${encodeURIComponent(postId)}/docs`), {}, fetchImpl);
  if (!Array.isArray(body.docs)) throw new SearchError('server', '관련 문서를 읽지 못했어요.');
  return body.docs.filter((doc) => typeof doc.title === 'string' && isSafeUrl(doc.url));
}
