import { handleAdmin } from './admin.js';
import { handleApi } from './api.js';
import { corsHeaders, errorBody, json } from './http.js';
import { runIngest } from './ingest/run.js';
import { purgeOldEvents } from './events.js';
import { purgeOldFeedback } from './feedback.js';
import { purgeOldMisses } from './misses.js';
import { WEEKLY_CRON, buildAndPublish } from './weekly.js';

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
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    const headers = { ...corsHeaders(request, env), 'x-request-id': requestId };
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (request.method === 'GET' && url.pathname === '/health/live') {
      return json({ status: 'live', requestId }, 200, headers);
    }
    if (request.method === 'GET' && url.pathname === '/health/ready') {
      const { status, body } = await checkReady(env, requestId);
      return json(body, status, headers);
    }
    const api = await handleApi(request, env, ctx, url, requestId, headers);
    if (api) return api;
    const admin = await handleAdmin(request, env, url, requestId, headers);
    if (admin) return admin;
    return json(errorBody('NOT_FOUND', 'Not found', requestId), 404, headers);
  },

  /** Cron triggers: Monday weekly insight (WEEKLY_CRON); otherwise one incremental sync pass (see docs/architecture.md, 수집) + miss/feedback/analytics log retention. */
  async scheduled(controller, env, ctx) {
    if (controller.cron === WEEKLY_CRON) {
      ctx.waitUntil(
        buildAndPublish(env).then(
          (week) =>
            console.log(JSON.stringify({ event: 'weekly_built', week: week.week, summarized: week.summary !== null, notion: week.notion })),
          (error) => console.error(JSON.stringify({ event: 'weekly_failed', error: String(error) })),
        ),
      );
      return;
    }
    ctx.waitUntil(
      runIngest(env).then(
        (report) => console.log(JSON.stringify({ event: 'ingest_run', cron: controller.cron, ...report })),
        (error) => console.error(JSON.stringify({ event: 'ingest_run_failed', error: String(error) })),
      ),
    );
    ctx.waitUntil(
      purgeOldMisses(env).catch((error) =>
        console.error(JSON.stringify({ event: 'purge_misses_failed', error: String(error) })),
      ),
    );
    ctx.waitUntil(
      purgeOldFeedback(env).catch((error) =>
        console.error(JSON.stringify({ event: 'purge_feedback_failed', error: String(error) })),
      ),
    );
    ctx.waitUntil(
      purgeOldEvents(env).catch((error) =>
        console.error(JSON.stringify({ event: 'purge_events_failed', error: String(error) })),
      ),
    );
  },
};
