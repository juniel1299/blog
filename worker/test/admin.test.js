import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/ingest/run.js', () => ({
  runIngest: vi.fn(async () => ({ indexed: [1], skipped: [], failed: [], deleted: [], remaining: 0 })),
  readPost: vi.fn(async ({ url }) => ({ post: { url }, chunks: [] })),
}));

const { default: worker } = await import('../src/index.js');
const { readPost } = await import('../src/ingest/run.js');

const TOKEN = 'a'.repeat(48);
const env = (token = TOKEN) => ({ ADMIN_TOKEN: token, BLOG_ORIGIN: 'https://blog.example.com', DB: {} });
const call = (path, { method = 'GET', auth } = {}, e = env()) =>
  worker.fetch(
    new Request(`https://api.test${path}`, { method, headers: auth ? { authorization: `Bearer ${auth}` } : {} }),
    e,
  );

afterEach(() => vi.restoreAllMocks());

describe('admin', () => {
  test('hidden (404) without a valid bearer token', async () => {
    expect((await call('/admin/ingest', { method: 'POST' })).status).toBe(404);
    expect((await call('/admin/ingest', { method: 'POST', auth: 'b'.repeat(48) })).status).toBe(404);
  });

  test('disabled when ADMIN_TOKEN is missing or too short, even if the header matches', async () => {
    expect((await call('/admin/ingest', { method: 'POST', auth: 'short' }, env('short'))).status).toBe(404);
    expect((await call('/admin/ingest', { method: 'POST', auth: 'undefined' }, env(undefined))).status).toBe(404);
  });

  test('POST /admin/ingest runs one sync pass', async () => {
    const res = await call('/admin/ingest', { method: 'POST', auth: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ indexed: [1] });
  });

  test('preview validates id and only fetches posts on the configured blog', async () => {
    expect((await call('/admin/preview?id=../x', { auth: TOKEN })).status).toBe(400);
    const res = await call('/admin/preview?id=123', { auth: TOKEN });
    expect(res.status).toBe(200);
    expect(readPost).toHaveBeenCalledWith({ url: 'https://blog.example.com/123' });
  });

  test('failures return a generic 500 without internals', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    readPost.mockRejectedValueOnce(new Error('secret internal detail'));
    const res = await call('/admin/preview?id=1', { auth: TOKEN });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('secret internal detail');
  });
});
