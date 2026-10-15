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

/**
 * @param {string} apiBase e.g. https://tistory-ai-assistant-api.<sub>.workers.dev
 * @param {string} query
 * @returns {Promise<{ postId: number, title: string, url: string, category: string | null, heading: string | null, preview: string }[]>}
 */
export async function searchBlog(apiBase, query, { fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/api/v1/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
  } catch {
    throw new SearchError('network', '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) throw new SearchError('rate', '질문이 너무 많아요. 잠시 후 다시 시도해 주세요.');
  if (!response.ok) throw new SearchError('server', '검색 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  const body = await response.json().catch(() => ({}));
  if (!Array.isArray(body.results)) throw new SearchError('server', '검색 결과를 읽지 못했어요.');
  return body.results.filter((result) => typeof result.title === 'string' && isSafeUrl(result.url));
}
