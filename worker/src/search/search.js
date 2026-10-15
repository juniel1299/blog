import { EMBEDDING_MODEL } from '../ingest/run.js';
import { makeSnippet, parseQuery } from './query.js';
import { fuseRankings, selectRankings } from './rank.js';

export const RESULT_LIMIT = 3;
const CANDIDATES = 20;
// Calibrated on the live index (2026-10-16): on-topic queries score 0.55-0.77, off-topic ones (weather,
// recipes, stocks) at most 0.48. At 0.4, "오늘 날씨" still pulled in a Calendar post through the body
// word "오늘", so body-only keyword hits use the same floor (they re-rank, never add). See docs/architecture.md, 검색.
export const MIN_VECTOR_SCORE = 0.5;
export const LOOSE_VECTOR_SCORE = 0.5;

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function ftsIds(env, columnFilter, ftsQuery) {
  const { results } = await env.DB.prepare(
    `SELECT chunk_id FROM post_chunks_fts WHERE post_chunks_fts MATCH ?
     ORDER BY bm25(post_chunks_fts, 0.0, 0.0, 5.0, 2.0, 1.0) LIMIT ?`,
  ).bind(`${columnFilter} : (${ftsQuery})`, CANDIDATES).all();
  return results.map((row) => row.chunk_id);
}

async function likeIds(env, columns, likeTerms) {
  const clauses = likeTerms.map(() => `(${columns.map((col) => `${col} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
  const args = likeTerms.flatMap((term) => Array(columns.length).fill(`%${escapeLike(term)}%`));
  const { results } = await env.DB.prepare(
    `SELECT c.id AS chunk_id FROM post_chunks c JOIN posts p ON p.id = c.post_id
     WHERE ${clauses.join(' OR ')} ORDER BY p.published_at DESC LIMIT ?`,
  ).bind(...args, CANDIDATES).all();
  return results.map((row) => row.chunk_id);
}

/**
 * Keyword candidates split by where they matched. FTS5 trigram handles 3+ char terms; LIKE covers
 * 2-char terms (e.g. "조인") that trigram cannot match.
 */
async function keywordCandidates(env, { ftsQuery, likeTerms }) {
  const none = Promise.resolve([]);
  const [ftsStrong, ftsBody, likeStrong, likeBody] = await Promise.all([
    ftsQuery ? ftsIds(env, '{title heading}', ftsQuery) : none,
    ftsQuery ? ftsIds(env, 'text', ftsQuery) : none,
    likeTerms.length ? likeIds(env, ['p.title', 'c.heading'], likeTerms) : none,
    likeTerms.length ? likeIds(env, ['c.text'], likeTerms) : none,
  ]);
  return { strong: [...new Set([...ftsStrong, ...likeStrong])], body: [...new Set([...ftsBody, ...likeBody])] };
}

async function vectorMatches(env, text) {
  const { data } = await env.AI.run(EMBEDDING_MODEL, { text: [text] });
  const { matches } = await env.VECTORIZE.query(data[0], { topK: CANDIDATES });
  return matches.map(({ id, score }) => ({ id, score }));
}

async function candidates(env, parsed) {
  const [keyword, vector] = await Promise.all([keywordCandidates(env, parsed), vectorMatches(env, parsed.text)]);
  return { ...keyword, vector };
}

const FLOORS = { strictFloor: MIN_VECTOR_SCORE, looseFloor: LOOSE_VECTOR_SCORE };

/** Raw candidates with scores and the final pick, for tuning via GET /admin/search-debug. */
export async function debugRankings(env, raw) {
  const parsed = parseQuery(raw);
  const found = await candidates(env, parsed);
  return {
    parsed,
    ...found,
    vector: found.vector.map(({ id, score }) => ({ id, score: Number(score.toFixed(4)) })),
    picked: fuseRankings(selectRankings(found, FLOORS), RESULT_LIMIT),
  };
}

/**
 * Hybrid search over indexed posts. Returns at most RESULT_LIMIT posts, best first, each with a one-line preview.
 * @param {string} raw user query (already length-validated)
 */
export async function searchPosts(env, raw) {
  const parsed = parseQuery(raw);
  const top = fuseRankings(selectRankings(await candidates(env, parsed), FLOORS), RESULT_LIMIT);
  if (top.length === 0) return [];

  const { results } = await env.DB.prepare(
    `SELECT c.id AS chunk_id, c.heading, c.text, p.id AS post_id, p.title, p.url, p.category
     FROM post_chunks c JOIN posts p ON p.id = c.post_id
     WHERE c.id IN (${top.map(() => '?').join(', ')})`,
  ).bind(...top.map((hit) => hit.chunkId)).all();
  const byChunk = new Map(results.map((row) => [row.chunk_id, row]));

  return top
    .map((hit) => byChunk.get(hit.chunkId))
    .filter(Boolean)
    .map((row) => ({
      postId: row.post_id,
      title: row.title,
      url: row.url,
      category: row.category,
      heading: row.heading,
      preview: makeSnippet(row.text, parsed.terms),
    }));
}
