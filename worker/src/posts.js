// Post listings that aren't keyword searches: recent posts and "posts like this one".
import { EMBEDDING_DIMENSIONS } from './ingest/run.js';
import { categoryMatches } from './search/intent.js';
import { makeSnippet } from './search/query.js';

// Average-of-chunks vs chunk similarity; calibrated like search (docs/architecture.md, 추천).
export const MIN_SIMILAR_SCORE = 0.55;
const SIMILAR_TOP_K = 30;
const RECENT_SCAN = 100; // posts are few; filter categories in JS
const PREVIEW_CHUNKS = 3;

/**
 * Card fields for the given post ids, in the given order, previewed from their first chunks.
 * @param {number[]} ids
 */
export async function postCards(env, ids) {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const [posts, chunks] = await Promise.all([
    env.DB.prepare(`SELECT id, title, url, category FROM posts WHERE id IN (${marks})`).bind(...ids).all(),
    env.DB.prepare(
      `SELECT post_id, text FROM post_chunks WHERE post_id IN (${marks}) AND position < ${PREVIEW_CHUNKS} ORDER BY post_id, position`,
    ).bind(...ids).all(),
  ]);
  const textByPost = new Map();
  for (const row of chunks.results) textByPost.set(row.post_id, `${textByPost.get(row.post_id) ?? ''}\n${row.text}`);
  const byId = new Map(posts.results.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      postId: row.id,
      title: row.title,
      url: row.url,
      category: row.category,
      heading: null,
      preview: makeSnippet(textByPost.get(row.id) ?? '', []),
    }));
}

/** Newest indexed posts, optionally within a category (see categoryMatches). */
export async function recentPosts(env, { limit, category = null }) {
  const { results } = await env.DB.prepare(
    `SELECT id, category FROM posts WHERE status = 'indexed' ORDER BY published_at DESC LIMIT ${RECENT_SCAN}`,
  ).all();
  const ids = results.filter((row) => !category || categoryMatches(row.category, category)).slice(0, limit).map((row) => row.id);
  return postCards(env, ids);
}

function averageVector(vectors) {
  const sum = new Array(EMBEDDING_DIMENSIONS).fill(0);
  for (const { values } of vectors) values.forEach((value, i) => (sum[i] += value));
  return sum.map((value) => value / vectors.length);
}

/**
 * Every other post's best chunk score against `postId`'s averaged chunk vector, best first (no floor).
 * Returns null when the post isn't indexed. Also backs GET /admin/similar-debug for tuning.
 */
export async function similarScores(env, postId) {
  const { results } = await env.DB.prepare('SELECT id FROM post_chunks WHERE post_id = ?').bind(postId).all();
  if (results.length === 0) return null;
  const vectors = (await env.VECTORIZE.getByIds(results.map((row) => row.id))).filter((v) => v.values?.length);
  if (vectors.length === 0) return [];

  const { matches } = await env.VECTORIZE.query(averageVector(vectors), { topK: SIMILAR_TOP_K });
  const best = new Map();
  for (const { id, score } of matches) {
    const other = Number(id.split('-')[0]);
    if (other !== postId && score > (best.get(other) ?? 0)) best.set(other, score);
  }
  return [...best.entries()].map(([id, score]) => ({ postId: id, score })).sort((a, b) => b.score - a.score);
}

/** Posts most similar to `postId` above MIN_SIMILAR_SCORE, as cards. null when the post isn't indexed. */
export async function similarPosts(env, postId, limit) {
  const scores = await similarScores(env, postId);
  if (scores === null) return null;
  const ids = scores.filter((s) => s.score >= MIN_SIMILAR_SCORE).slice(0, limit).map((s) => s.postId);
  return postCards(env, ids);
}
