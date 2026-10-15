import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../src/ingest/extract.js', () => ({ extractPost: vi.fn() }));

const { extractPost } = await import('../../src/ingest/extract.js');
const { runIngest, EMBEDDING_DIMENSIONS } = await import('../../src/ingest/run.js');

const ORIGIN = 'https://blog.example.com';
const NOW = new Date('2026-10-16T00:00:00Z');

function sitemap(entries) {
  return `<urlset>${entries.map(([id, lastmod]) => `<url><loc>${ORIGIN}/${id}</loc><lastmod>${lastmod}</lastmod></url>`).join('')}</urlset>`;
}

/** Minimal D1 stand-in: answers the two SELECTs run.js issues and records every batch. */
function fakeDb({ posts = [], chunkIds = {} } = {}) {
  const batches = [];
  const prepare = (sql) => ({
    sql,
    args: [],
    bind(...args) { return { ...this, args }; },
    async all() {
      if (sql.startsWith('SELECT id, source_lastmod')) return { results: posts };
      if (sql.startsWith('SELECT id FROM post_chunks')) return { results: (chunkIds[this.args[0]] ?? []).map((id) => ({ id })) };
      throw new Error(`unexpected query ${sql}`);
    },
  });
  return { prepare, batch: vi.fn(async (statements) => { batches.push(statements); }), batches };
}

function env({ db = fakeDb(), upsert = vi.fn(), deleteByIds = vi.fn() } = {}) {
  return {
    BLOG_ORIGIN: ORIGIN,
    DB: db,
    VECTORIZE: { upsert, deleteByIds },
    AI: { run: vi.fn(async (_model, { text }) => ({ data: text.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.1)) })) },
  };
}

function post(overrides = {}) {
  return {
    title: 'Index 란?', category: 'SQL', tags: ['oracle'], summary: 's', publishedAt: '2025-10-06T10:00:00+09:00',
    sections: [{ heading: null, text: 'intro' }, { heading: '이점', text: '빠름' }],
    ...overrides,
  };
}

let pages;
beforeEach(() => {
  pages = {};
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === `${ORIGIN}/sitemap.xml`) return new Response(pages.sitemap ?? '', { status: pages.sitemap ? 200 : 500 });
    return new Response('<html></html>', { status: pages[url] ?? 200 });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  extractPost.mockReset();
});

describe('runIngest', () => {
  test('indexes a new post: embeds title+heading+text, upserts vectors, writes post + chunks + fts', async () => {
    pages.sitemap = sitemap([[122, '2025-10-06']]);
    extractPost.mockResolvedValue(post());
    const e = env();

    const report = await runIngest(e, { now: NOW });

    expect(report).toEqual({ indexed: [122], skipped: [], failed: [], deleted: [], remaining: 0 });
    expect(e.AI.run.mock.calls[0][1].text).toEqual(['Index 란?\nintro', 'Index 란?\n이점\n빠름']);
    const vectors = e.VECTORIZE.upsert.mock.calls[0][0];
    expect(vectors.map((v) => [v.id, v.metadata])).toEqual([['122-0', { postId: 122 }], ['122-1', { postId: 122 }]]);
    const statements = e.DB.batches[0];
    expect(statements[0].sql).toMatch(/^INSERT INTO posts/);
    expect(statements[0].args).toContain('2025-10-06');
    expect(statements[0].args).toContain('indexed');
    expect(statements.filter((s) => s.sql.startsWith('INSERT INTO post_chunks ')).map((s) => s.args[0])).toEqual(['122-0', '122-1']);
    expect(statements.filter((s) => s.sql.startsWith('INSERT INTO post_chunks_fts'))).toHaveLength(2);
  });

  test('re-index drops vectors for chunks that no longer exist', async () => {
    pages.sitemap = sitemap([[122, '2025-12-01']]);
    extractPost.mockResolvedValue(post({ sections: [{ heading: null, text: 'only one now' }] }));
    const e = env({ db: fakeDb({ posts: [{ id: 122, source_lastmod: '2025-10-06' }], chunkIds: { 122: ['122-0', '122-1', '122-2'] } }) });

    await runIngest(e, { now: NOW });

    expect(e.VECTORIZE.deleteByIds).toHaveBeenCalledWith(['122-1', '122-2']);
  });

  test('protected/empty post is stored as skipped without embedding', async () => {
    pages.sitemap = sitemap([[7, '2025-01-01']]);
    extractPost.mockResolvedValue(post({ title: '', sections: [{ heading: null, text: '' }] }));
    const e = env();

    const report = await runIngest(e, { now: NOW });

    expect(report.skipped).toEqual([7]);
    expect(e.AI.run).not.toHaveBeenCalled();
    expect(e.DB.batches[0][0].args).toContain('skipped');
  });

  test('a failing post is reported and does not touch D1, others still index', async () => {
    pages.sitemap = sitemap([[1, '2025-02-01'], [2, '2025-01-01']]);
    extractPost.mockResolvedValue(post());
    const upsert = vi.fn().mockRejectedValueOnce(new Error('vectorize down')).mockResolvedValue(undefined);
    const e = env({ upsert });

    const report = await runIngest(e, { now: NOW });

    expect(report.failed).toEqual([1]);
    expect(report.indexed).toEqual([2]);
    expect(e.DB.batches).toHaveLength(1);
  });

  test('posts gone from the sitemap are deleted from Vectorize and D1', async () => {
    pages.sitemap = sitemap([[1, '2025-02-01']]);
    const e = env({ db: fakeDb({ posts: [{ id: 1, source_lastmod: '2025-02-01' }, { id: 9, source_lastmod: 'x' }], chunkIds: { 9: ['9-0'] } }) });

    const report = await runIngest(e, { now: NOW });

    expect(report.deleted).toEqual([9]);
    expect(e.VECTORIZE.deleteByIds).toHaveBeenCalledWith(['9-0']);
    expect(e.DB.batches[0].map((s) => s.sql)).toContain('DELETE FROM posts WHERE id = ?');
  });

  test('sitemap failure aborts the run before any write', async () => {
    const e = env();
    await expect(runIngest(e, { now: NOW })).rejects.toThrow(/sitemap/);
    expect(e.DB.batch).not.toHaveBeenCalled();
  });
});
