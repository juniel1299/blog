// Question topics and content gaps for the insight dashboard: groups visitors' questions by meaning
// (bge-m3 embeddings, the model the search already uses) and flags topics the blog answers badly.
import { feedbackReport } from './feedback.js';
import { EMBEDDING_MODEL } from './ingest/run.js';
import { topMisses } from './misses.js';

// Calibrated on bge-m3 (2026-10-24): same-topic wordings scored 0.53-0.92 ("오라클 인덱스 / 인덱스 단점" 0.59,
// "cors 에러 해결 / cors란" 0.64), different topics at most 0.48. See docs/rag-design.md, 인사이트.
export const TOPIC_SIMILARITY = 0.55;
// A post this close to a topic covers it (the bar the similar-posts list uses).
export const COVERED_SCORE = 0.55;
const MAX_QUESTIONS = 100; // one embedding call
const LOW_CLICK_MIN_ASKS = 3;
const LOW_CLICK_RATE = 0.2;
const TOPIC_LIMIT = 15;
const GAP_LIMIT = 10;
const EXAMPLE_LIMIT = 3;

const KINDS = () => ({ asked: 0, miss: 0, disliked: 0, lowClick: 0 });

function unit(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return norm ? vector.map((v) => v / norm) : vector;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Greedy grouping, most-asked first: each question joins the closest topic whose centroid it matches at
 * `threshold` or above, else starts a new topic. The label is the topic's most-asked wording.
 * @param {{ query: string, count: number, kinds: Record<string, number> }[]} items
 * @param {number[][]} vectors aligned with items
 */
export function clusterQuestions(items, vectors, threshold = TOPIC_SIMILARITY) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].count - items[a].count);
  const clusters = [];
  for (const i of order) {
    let best = null;
    let bestScore = threshold;
    for (const cluster of clusters) {
      const score = cosine(vectors[i], cluster.sum);
      if (score >= bestScore) [best, bestScore] = [cluster, score];
    }
    if (!best) {
      best = { label: items[i].query, count: 0, members: [], kinds: KINDS(), sum: new Array(vectors[i].length).fill(0) };
      clusters.push(best);
    }
    best.count += items[i].count;
    best.members.push(items[i]);
    for (const kind of Object.keys(best.kinds)) best.kinds[kind] += items[i].kinds[kind] ?? 0;
    vectors[i].forEach((value, d) => (best.sum[d] += value * items[i].count));
  }
  return clusters
    .sort((a, b) => b.count - a.count)
    .map(({ label, count, members, kinds, sum }) => ({
      label,
      count,
      examples: members.slice(0, EXAMPLE_LIMIT).map((m) => m.query),
      kinds,
      vector: unit(sum),
    }));
}

/** 'new' = nothing in the blog covers it, 'improve' = a close post exists but readers were not served, null = fine. */
export function gapType(kinds, nearestScore) {
  if (kinds.miss + kinds.disliked + kinds.lowClick === 0) return null;
  return nearestScore !== null && nearestScore >= COVERED_SCORE ? 'improve' : 'new';
}

/** Distinct questions with how they went: asked (found posts), miss (zero results), disliked (👎), lowClick. */
async function questionItems(env, days) {
  const since = `-${days} days`;
  const [asked, clicks, misses, feedback] = await Promise.all([
    env.DB.prepare(
      `/* topic_questions */ SELECT query, count(*) AS n FROM search_queries WHERE created_at >= datetime('now', ?1)
       GROUP BY query ORDER BY n DESC LIMIT ${MAX_QUESTIONS}`,
    ).bind(since).all().then((r) => r.results),
    env.DB.prepare(
      `/* topic_clicks */ SELECT query, count(*) AS clicks FROM result_clicks
       WHERE created_at >= datetime('now', ?1) AND query IS NOT NULL GROUP BY query`,
    ).bind(since).all().then((r) => r.results),
    topMisses(env, days),
    feedbackReport(env, days),
  ]);
  const clicksByQuery = new Map(clicks.map((row) => [row.query, row.clicks]));
  const items = new Map();
  const add = (query, kind, n) => {
    const entry = items.get(query) ?? { query, count: 0, kinds: KINDS() };
    entry.count += n;
    entry.kinds[kind] += n;
    items.set(query, entry);
  };
  for (const row of asked) {
    add(row.query, 'asked', row.n);
    const clickRate = (clicksByQuery.get(row.query) ?? 0) / row.n;
    if (row.n >= LOW_CLICK_MIN_ASKS && clickRate < LOW_CLICK_RATE) items.get(row.query).kinds.lowClick += 1;
  }
  for (const row of misses) add(row.query, 'miss', row.count);
  for (const row of feedback.queries) if (row.down > 0) add(row.query, 'disliked', row.down);
  return [...items.values()].sort((a, b) => b.count - a.count).slice(0, MAX_QUESTIONS);
}

/** Closest post per gap topic, by its centroid, with titles. */
async function nearestPosts(env, gaps) {
  const best = await Promise.all(
    gaps.map(async (gap) => {
      const { matches } = await env.VECTORIZE.query(gap.vector, { topK: 3 });
      const top = matches[0];
      return top ? { postId: Number(top.id.split('-')[0]), score: Number(top.score.toFixed(2)) } : null;
    }),
  );
  const ids = [...new Set(best.filter(Boolean).map((b) => b.postId))];
  const titles = new Map();
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id, title, url FROM posts WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all();
    for (const row of results) titles.set(row.id, row);
  }
  return best.map((b) => (b ? { postId: b.postId, title: titles.get(b.postId)?.title ?? null, url: titles.get(b.postId)?.url ?? null, score: b.score } : null));
}

const publicTopic = ({ label, count, examples, kinds }) => ({ label, count, examples, kinds });

/** @returns {Promise<{ topics: object[], gaps: object[] }>} */
export async function topicReport(env, days) {
  const items = await questionItems(env, days);
  if (items.length === 0) return { topics: [], gaps: [] };
  const { data } = await env.AI.run(EMBEDDING_MODEL, { text: items.map((item) => item.query) });
  const clusters = clusterQuestions(items, data);

  const unhappy = clusters.filter((c) => c.kinds.miss + c.kinds.disliked + c.kinds.lowClick > 0).slice(0, GAP_LIMIT);
  const nearest = await nearestPosts(env, unhappy);
  const gaps = unhappy
    .map((cluster, i) => ({ ...publicTopic(cluster), type: gapType(cluster.kinds, nearest[i]?.score ?? null), nearest: nearest[i] }))
    .filter((gap) => gap.type);

  return { topics: clusters.slice(0, TOPIC_LIMIT).map(publicTopic), gaps };
}
