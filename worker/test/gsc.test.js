import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import worker from '../src/index.js';
import { GSC_CRON, accessToken, googleReport, postIdOfPage, syncSearchConsole } from '../src/gsc.js';

let privatePem;
let publicKey;

const b64 = (buf) => Buffer.from(buf).toString('base64');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  publicKey = pair.publicKey;
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  privatePem = `-----BEGIN PRIVATE KEY-----\n${b64(der).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
});

afterEach(() => vi.restoreAllMocks());

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

describe('accessToken', () => {
  test('signs an RS256 service-account JWT and trades it for an access token', async () => {
    // Secrets pasted from the JSON key file often keep "\n" as two characters.
    const env = { GSC_CLIENT_EMAIL: 'bot@proj.iam.gserviceaccount.com', GSC_PRIVATE_KEY: privatePem.replace(/\n/g, '\\n') };
    const fetchImpl = vi.fn(async () => ok({ access_token: 'ya29.token', expires_in: 3599 }));
    const now = Date.UTC(2026, 10, 1);

    expect(await accessToken(env, fetchImpl, now)).toBe('ya29.token');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [header, claims, signature] = form.get('assertion').split('.');
    expect(JSON.parse(fromB64url(header))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(fromB64url(claims))).toEqual({
      iss: 'bot@proj.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromB64url(signature), new TextEncoder().encode(`${header}.${claims}`));
    expect(valid).toBe(true);
  });

  test("a refused token says Google's reason, never the key", async () => {
    const env = { GSC_CLIENT_EMAIL: 'bot@x', GSC_PRIVATE_KEY: privatePem };
    const fetchImpl = async () => new Response('{"error":"invalid_grant","error_description":"Invalid JWT Signature."}', { status: 400 });
    const error = await accessToken(env, fetchImpl).catch((e) => e);
    expect(String(error)).toBe('Error: Google token failed: HTTP 400 (invalid_grant: Invalid JWT Signature.)');
    expect(String(error)).not.toContain('PRIVATE KEY');
  });
});

describe('postIdOfPage', () => {
  test.each([
    ['https://problem-child.tistory.com/98', 98],
    ['https://problem-child.tistory.com/m/122', 122],
    ['https://problem-child.tistory.com/98?category=1', 98],
    ['https://problem-child.tistory.com/', null],
    ['https://problem-child.tistory.com/category/java', null],
  ])('%s -> %s', (page, id) => {
    expect(postIdOfPage(page)).toBe(id);
  });
});

describe('syncSearchConsole', () => {
  function env(configured = true) {
    const batches = [];
    return {
      batches,
      ...(configured
        ? { GSC_CLIENT_EMAIL: 'bot@x', GSC_PRIVATE_KEY: privatePem, GSC_SITE: 'https://problem-child.tistory.com/' }
        : {}),
      DB: {
        prepare: (sql) => ({ bind: (...args) => ({ sql, args }) }),
        batch: async (statements) => {
          batches.push(statements);
          return [];
        },
      },
    };
  }

  test('not configured: does nothing', async () => {
    const fetchImpl = vi.fn();
    expect(await syncSearchConsole(env(false), fetchImpl)).toEqual({ skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('replaces the last 7 days with query x page rows, linked to posts', async () => {
    const e = env();
    const fetchImpl = vi.fn(async (url) =>
      url.includes('oauth2')
        ? ok({ access_token: 'ya29.t' })
        : ok({
            rows: [
              { keys: ['2026-10-29', '자바 상속', 'https://problem-child.tistory.com/78'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 },
              { keys: ['2026-10-30', '주니엘', 'https://problem-child.tistory.com/'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
            ],
          }),
    );
    const result = await syncSearchConsole(e, fetchImpl, new Date('2026-11-01T21:00:00Z'));
    expect(result).toEqual({ rows: 2, start: '2026-10-26', end: '2026-11-01' });

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fproblem-child.tistory.com%2F/searchAnalytics/query');
    expect(init.headers.authorization).toBe('Bearer ya29.t');
    expect(JSON.parse(init.body)).toMatchObject({ startDate: '2026-10-26', endDate: '2026-11-01', dimensions: ['date', 'query', 'page'], dataState: 'all' });

    const statements = e.batches.flat();
    expect(statements[0].sql).toContain('DELETE FROM gsc_rows');
    expect(statements[0].args).toEqual(['2026-10-26', '2026-11-01']);
    expect(statements.slice(1).map((s) => s.args)).toEqual([
      ['2026-10-29', '자바 상속', 'https://problem-child.tistory.com/78', 78, 3, 40, 4.2],
      ['2026-10-30', '주니엘', 'https://problem-child.tistory.com/', null, 1, 2, 1],
    ]);
  });

  test("a Search Console error says Google's reason", async () => {
    const fetchImpl = async (url) =>
      url.includes('oauth2')
        ? ok({ access_token: 'ya29.t' })
        : new Response('{"error":{"code":403,"message":"User does not have sufficient permission for site."}}', { status: 403 });
    const error = await syncSearchConsole(env(), fetchImpl).catch((e) => e);
    expect(String(error)).toBe('Error: Search Console query failed: HTTP 403 (User does not have sufficient permission for site.)');
  });
});

describe('googleReport', () => {
  test('totals, top queries and low click-through queries with weighted position', async () => {
    const env = {
      DB: {
        prepare: (sql) => ({
          bind: () => ({
            first: async () => (sql.includes('/* gsc_totals */') ? { clicks: 12, impressions: 600, position: 8.44 } : null),
            all: async () => ({
              results: sql.includes('/* gsc_queries */')
                ? [{ query: '자바 상속', clicks: 9, impressions: 120, position: 3.26 }]
                : sql.includes('/* gsc_low_ctr */')
                  ? [{ query: '오라클 인덱스 단점', clicks: 0, impressions: 300, position: 6.04 }]
                  : [],
            }),
          }),
        }),
      },
    };
    expect(await googleReport(env, 7)).toEqual({
      totals: { clicks: 12, impressions: 600, ctr: 0.02, position: 8.4 },
      queries: [{ query: '자바 상속', clicks: 9, impressions: 120, ctr: 0.075, position: 3.3 }],
      lowCtr: [{ query: '오라클 인덱스 단점', clicks: 0, impressions: 300, ctr: 0, position: 6 }],
    });
  });
});

describe('daily cron', () => {
  test('the Search Console cron syncs (skipped without secrets) and purges old rows, without the ingest run', async () => {
    const ran = [];
    const env = { DB: { prepare: (sql) => ({ bind: () => ({ run: async () => ran.push(sql) }) }) } };
    const waits = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker.scheduled({ cron: GSC_CRON }, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(waits).toHaveLength(1);
    expect(ran).toEqual([expect.stringContaining('DELETE FROM gsc_rows WHERE date <')]);
  });
});
