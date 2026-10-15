const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * @param {Request} request
 * @param {{ ALLOWED_ORIGINS?: string }} env
 * @returns {Record<string, string>}
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

export function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function errorBody(code, message, requestId) {
  return { error: { code, message }, requestId };
}
