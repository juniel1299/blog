// Google Search Console: the search words Google does not pass in referrers. A daily cron pulls the last
// 7 days of query x page rows (migrations/0008_search_console.sql) with a service account, signed here
// with WebCrypto. Needs secrets GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, GSC_SITE (docs/operations.md).
import { RETENTION_DAYS } from './misses.js';

// Cloudflare cron is UTC: 21:00 UTC = 06:00 KST. Must match wrangler.jsonc.
export const GSC_CRON = '0 21 * * *';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://www.googleapis.com/webmasters/v3/sites';
const SYNC_DAYS = 7; // Google keeps revising recent days, so they are replaced every run
const ROW_LIMIT = 5000;
const BATCH_SIZE = 100;
const LIST_LIMIT = 20;
const LOW_CTR_LIMIT = 10;
const LOW_CTR_MIN_IMPRESSIONS = 20;
const LOW_CTR_RATE = 0.02;
const DAY_MS = 24 * 60 * 60 * 1000;

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeJson = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** PEM (as pasted from the JSON key file, possibly with literal "\n") -> PKCS#8 bytes. */
function pemBytes(pem) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** OAuth access token for the service account (JWT bearer grant). Errors carry Google's reason, never the key. */
export async function accessToken(env, fetchImpl = fetch, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({
    iss: env.GSC_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(env.GSC_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(signature)}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const reason = [body.error, body.error_description].filter(Boolean).join(': ');
    throw new Error(`Google token failed: HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  return body.access_token;
}

/** Post number from a blog URL ("/98", "/m/98"), else null. */
export function postIdOfPage(page) {
  const match = page.match(/^https?:\/\/[^/]+\/(?:m\/)?(\d{1,9})(?:[/?#]|$)/);
  return match ? Number(match[1]) : null;
}

const isoDate = (date) => date.toISOString().slice(0, 10);

/** Replaces the last 7 days of rows. Throws with Google's reason on API errors. */
export async function syncSearchConsole(env, fetchImpl = fetch, now = new Date()) {
  if (!env.GSC_CLIENT_EMAIL || !env.GSC_PRIVATE_KEY || !env.GSC_SITE) return { skipped: true };
  const end = isoDate(now);
  const start = isoDate(new Date(now.getTime() - (SYNC_DAYS - 1) * DAY_MS));
  const token = await accessToken(env, fetchImpl, now.getTime());
  const res = await fetchImpl(`${API}/${encodeURIComponent(env.GSC_SITE)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['date', 'query', 'page'], rowLimit: ROW_LIMIT, dataState: 'all' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body.error?.message;
    throw new Error(`Search Console query failed: HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
  }
  const rows = body.rows ?? [];
  const inserts = rows.map(({ keys: [date, query, page], clicks, impressions, position }) =>
    env.DB.prepare(
      'INSERT OR REPLACE INTO gsc_rows (date, query, page, post_id, clicks, impressions, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(date, query, page, postIdOfPage(page), clicks, impressions, position),
  );
  const statements = [env.DB.prepare('DELETE FROM gsc_rows WHERE date BETWEEN ? AND ?').bind(start, end), ...inserts];
  for (let i = 0; i < statements.length; i += BATCH_SIZE) await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
  return { rows: rows.length, start, end };
}

export async function purgeOldSearchConsole(env) {
  await env.DB.prepare(`DELETE FROM gsc_rows WHERE date < date('now', ?)`).bind(`-${RETENTION_DAYS} days`).run();
}

const round = (value, digits) => Number((value ?? 0).toFixed(digits));
const metrics = ({ clicks, impressions, position }) => ({
  clicks: clicks ?? 0,
  impressions: impressions ?? 0,
  ctr: impressions ? round(clicks / impressions, 3) : 0,
  position: round(position, 1),
});
const withQuery = (row) => ({ query: row.query, ...metrics(row) });

/** Google search totals, top queries, and queries Google shows often but that rarely get clicked. */
export async function googleReport(env, days) {
  const since = `-${days} days`;
  // Average position weighted by impressions, as Search Console reports it.
  const columns = 'sum(clicks) AS clicks, sum(impressions) AS impressions, sum(position * impressions) / sum(impressions) AS position';
  const [totals, queries, lowCtr] = await Promise.all([
    env.DB.prepare(`/* gsc_totals */ SELECT ${columns} FROM gsc_rows WHERE date >= date('now', ?)`).bind(since).first(),
    env.DB.prepare(
      `/* gsc_queries */ SELECT query, ${columns} FROM gsc_rows WHERE date >= date('now', ?)
       GROUP BY query ORDER BY clicks DESC, impressions DESC LIMIT ${LIST_LIMIT}`,
    ).bind(since).all().then((r) => r.results),
    env.DB.prepare(
      `/* gsc_low_ctr */ SELECT query, ${columns} FROM gsc_rows WHERE date >= date('now', ?)
       GROUP BY query HAVING sum(impressions) >= ${LOW_CTR_MIN_IMPRESSIONS} AND sum(clicks) * 1.0 / sum(impressions) < ${LOW_CTR_RATE}
       ORDER BY impressions DESC LIMIT ${LOW_CTR_LIMIT}`,
    ).bind(since).all().then((r) => r.results),
  ]);
  return {
    totals: metrics(totals ?? {}),
    queries: queries.map(withQuery),
    lowCtr: lowCtr.map(withQuery),
  };
}
