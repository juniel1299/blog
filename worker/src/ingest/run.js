import { chunkSections } from './chunk.js';
import { extractPost } from './extract.js';
import { parseSitemap, planSync } from './sitemap.js';

export const POSTS_PER_RUN = 3;
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const EMBEDDING_DIMENSIONS = 1024;
const EMBED_BATCH = 20;
const USER_AGENT = 'tistory-ai-assistant-indexer';

/** Title + heading give each chunk vector the context the chunk text alone lacks. */
export function embeddingText(post, chunk) {
  return [post.title, chunk.heading, chunk.text].filter(Boolean).join('\n');
}

async function embed(env, texts) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const { data } = await env.AI.run(EMBEDDING_MODEL, { text: texts.slice(i, i + EMBED_BATCH) });
    vectors.push(...data);
  }
  if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error(`embedding shape mismatch: got ${vectors.length} vectors for ${texts.length} texts`);
  }
  return vectors;
}

async function storedChunkIds(env, postId) {
  const { results } = await env.DB.prepare('SELECT id FROM post_chunks WHERE post_id = ?').bind(postId).all();
  return results.map((row) => row.id);
}

function deleteRowsStatements(env, postId) {
  return [
    env.DB.prepare('DELETE FROM post_chunks_fts WHERE post_id = ?').bind(postId),
    env.DB.prepare('DELETE FROM post_chunks WHERE post_id = ?').bind(postId),
  ];
}

/** Fetches, parses and chunks one post without writing anything. Also backs the admin preview. */
export async function readPost(entry) {
  const response = await fetch(entry.url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`fetch ${entry.url} failed: HTTP ${response.status}`);
  const post = await extractPost(response);
  return { post, chunks: chunkSections(post.sections) };
}

async function indexPost(env, entry, now) {
  const { post, chunks } = await readPost(entry);
  const oldIds = await storedChunkIds(env, entry.id);
  const ids = chunks.map((chunk) => `${entry.id}-${chunk.position}`);
  // Protected or empty posts have no body: keep a 'skipped' row so they aren't refetched every run.
  const status = chunks.length > 0 && post.title ? 'indexed' : 'skipped';

  if (status === 'indexed') {
    const vectors = await embed(env, chunks.map((chunk) => embeddingText(post, chunk)));
    await env.VECTORIZE.upsert(ids.map((id, i) => ({ id, values: vectors[i], metadata: { postId: entry.id } })));
  }
  const stale = oldIds.filter((id) => status === 'skipped' || !ids.includes(id));
  if (stale.length > 0) await env.VECTORIZE.deleteByIds(stale);

  // D1 last: if Vectorize failed above, source_lastmod stays old and the next run retries this post.
  const indexed = status === 'indexed' ? chunks : [];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts (id, url, title, category, tags, summary, published_at, source_lastmod, status, chunk_count, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title, category = excluded.category,
         tags = excluded.tags, summary = excluded.summary, published_at = excluded.published_at,
         source_lastmod = excluded.source_lastmod, status = excluded.status,
         chunk_count = excluded.chunk_count, indexed_at = excluded.indexed_at`,
    ).bind(
      entry.id, entry.url, post.title || entry.url, post.category || null, JSON.stringify(post.tags),
      post.summary || null, post.publishedAt, entry.lastmod, status, indexed.length, now.toISOString(),
    ),
    ...deleteRowsStatements(env, entry.id),
    ...indexed.flatMap((chunk, i) => [
      env.DB.prepare('INSERT INTO post_chunks (id, post_id, position, heading, text) VALUES (?, ?, ?, ?, ?)')
        .bind(ids[i], entry.id, chunk.position, chunk.heading, chunk.text),
      env.DB.prepare('INSERT INTO post_chunks_fts (chunk_id, post_id, title, heading, text) VALUES (?, ?, ?, ?, ?)')
        .bind(ids[i], entry.id, post.title, chunk.heading ?? '', chunk.text),
    ]),
  ]);
  return status;
}

async function deletePost(env, postId) {
  const ids = await storedChunkIds(env, postId);
  if (ids.length > 0) await env.VECTORIZE.deleteByIds(ids);
  await env.DB.batch([...deleteRowsStatements(env, postId), env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(postId)]);
}

/**
 * One sync pass: sitemap diff -> delete removed posts -> (re)index up to `limit` changed posts.
 * Called by the cron trigger and by POST /admin/ingest.
 */
export async function runIngest(env, { limit = POSTS_PER_RUN, now = new Date() } = {}) {
  const origin = env.BLOG_ORIGIN;
  const sitemap = await fetch(`${origin}/sitemap.xml`, { headers: { 'user-agent': USER_AGENT } });
  if (!sitemap.ok) throw new Error(`sitemap fetch failed: HTTP ${sitemap.status}`);
  const entries = parseSitemap(await sitemap.text(), origin);

  const { results } = await env.DB.prepare('SELECT id, source_lastmod FROM posts').all();
  const plan = planSync(entries, new Map(results.map((row) => [row.id, row.source_lastmod])), limit);

  const report = { indexed: [], skipped: [], failed: [], deleted: [], remaining: plan.remaining };
  for (const id of plan.toDelete) {
    await deletePost(env, id);
    report.deleted.push(id);
  }
  for (const entry of plan.toIndex) {
    try {
      report[await indexPost(env, entry, now)].push(entry.id);
    } catch (error) {
      console.error(JSON.stringify({ event: 'index_failed', postId: entry.id, error: String(error) }));
      report.failed.push(entry.id);
    }
  }
  return report;
}
