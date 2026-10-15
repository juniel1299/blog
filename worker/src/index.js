const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * @param {Request} request
 * @param {{ ALLOWED_ORIGINS?: string }} env
 * @returns {Record<string, string>}
 */
function corsHeaders(request, env) {
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

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function errorBody(code, message, requestId) {
  return { error: { code, message }, requestId };
}

async function checkReady(env, requestId) {
  try {
    await env.DB.prepare('SELECT 1').first();
    return { status: 200, body: { status: 'ready', requestId } };
  } catch (error) {
    // Details go to Workers logs only; the client gets a generic message.
    console.error(JSON.stringify({ requestId, event: 'ready_check_failed', error: String(error) }));
    return { status: 503, body: errorBody('NOT_READY', 'Service is not ready', requestId) };
  }
}

export default {
  /**
   * @param {Request} request
   * @param {{ DB: D1Database, ALLOWED_ORIGINS?: string }} env
   */
  async fetch(request, env) {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    const headers = { ...corsHeaders(request, env), 'x-request-id': requestId };
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (request.method === 'GET' && pathname === '/health/live') {
      return json({ status: 'live', requestId }, 200, headers);
    }
    if (request.method === 'GET' && pathname === '/health/ready') {
      const { status, body } = await checkReady(env, requestId);
      return json(body, status, headers);
    }
    return json(errorBody('NOT_FOUND', 'Not found', requestId), 404, headers);
  },
};
