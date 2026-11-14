// Writing helper (dashboard "새 글 도우미"): for a draft, the blog's own posts worth linking, the usual
// category/tags of those posts, the series it continues, and curated official docs. Reuses the search
// embeddings, the similar-posts bar, series detection and doc matching.
import { loadDocs, matchDocs } from './docs.js';
import { EMBEDDING_MODEL } from './ingest/run.js';
import { MIN_SIMILAR_SCORE, seriesOf } from './posts.js';

const DRAFT_EMBED_CHARS = 1500;
const TOP_K = 30;
const RELATED_LIMIT = 5;
const TAG_LIMIT = 8;
const SERIES_PREFIX = /^\s*\[([^\]]+)\]/;

const parseTags = (value) => {
  try {
    return JSON.parse(value).filter((tag) => typeof tag === 'string');
  } catch {
    return [];
  }
};

/** Most frequent values first (case-insensitive, first spelling kept). */
function ranked(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value.toLowerCase();
    const entry = counts.get(key) ?? { value, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((entry) => entry.value);
}

/** Series the draft's "[Name] ..." title continues: existing episodes and the next number. */
function seriesFor(title, posts) {
  const prefix = title.match(SERIES_PREFIX)?.[1].trim().toLowerCase();
  if (!prefix) return null;
  const episodes = posts.map((post) => ({ post, series: seriesOf(post.title) })).filter((e) => e.series?.key === prefix);
  if (episodes.length === 0) return null;
  const last = episodes.reduce((a, b) => (b.series.order > a.series.order ? b : a));
  return { name: last.series.name, count: episodes.length, nextOrder: last.series.order + 1, last: { title: last.post.title, url: last.post.url } };
}

/** @param {{ title: string, text: string }} draft */
export async function assistDraft(env, { title, text }) {
  const [{ data }, docs, { results: posts }] = await Promise.all([
    env.AI.run(EMBEDDING_MODEL, { text: [`${title}\n${text.slice(0, DRAFT_EMBED_CHARS)}`] }),
    loadDocs(env),
    env.DB.prepare("SELECT id, title, url, category, tags FROM posts WHERE status = 'indexed'").all(),
  ]);
  const { matches } = await env.VECTORIZE.query(data[0], { topK: TOP_K });
  const best = new Map();
  for (const { id, score } of matches) {
    const postId = Number(id.split('-')[0]);
    if (score >= MIN_SIMILAR_SCORE && score > (best.get(postId) ?? 0)) best.set(postId, score);
  }
  const byId = new Map(posts.map((post) => [post.id, post]));
  const related = [...best.entries()]
    .filter(([id]) => byId.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, RELATED_LIMIT)
    .map(([id, score]) => ({ postId: id, title: byId.get(id).title, url: byId.get(id).url, score: Number(score.toFixed(2)) }));
  const relatedPosts = related.map((r) => byId.get(r.postId));
  const category = ranked(relatedPosts.map((p) => p.category).filter(Boolean))[0] ?? null;
  const tags = ranked(relatedPosts.flatMap((p) => parseTags(p.tags))).slice(0, TAG_LIMIT);
  return {
    related,
    category,
    tags,
    series: seriesFor(title, posts),
    docs: matchDocs({ title, category, tags }, docs),
  };
}
