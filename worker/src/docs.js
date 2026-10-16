import { stripParticle } from './search/query.js';

export const DOCS_LIMIT = 3;
// Where a keyword matched says how much the post is really about it.
const WEIGHT = { tag: 3, category: 2, title: 1 };

function words(text) {
  return text
    .toLowerCase()
    .split(/[^0-9a-z가-힣+#.]+/)
    .filter(Boolean)
    .map(stripParticle);
}

/**
 * Lowercased match sources for a post. Tags/category parts match whole; title matches whole words
 * (particles stripped) so "자바" does not match "자바스크립트"; multi-word keywords ("spring boot")
 * match as a substring of the title.
 * @param {{ title: string, category: string | null, tags: string[] }} post
 */
function postSignals(post) {
  const categoryParts = (post.category ?? '')
    .toLowerCase()
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    tag: new Set(post.tags.map((tag) => tag.toLowerCase().trim())),
    // "sql(oracle)" also yields "sql" and "oracle"
    category: new Set(categoryParts.flatMap((part) => [part, ...words(part)])),
    titleWords: new Set(words(post.title)),
    titleText: post.title.toLowerCase(),
  };
}

function keywordWeight(keyword, signals) {
  if (signals.tag.has(keyword)) return WEIGHT.tag;
  if (signals.category.has(keyword)) return WEIGHT.category;
  if (signals.titleWords.has(keyword) || (keyword.includes(' ') && signals.titleText.includes(keyword))) {
    return WEIGHT.title;
  }
  return 0;
}

/**
 * Ranks curated doc links for a post. Keywords shared by many docs ("react" is on 8) count less than
 * rare ones ("foreach"), so the most specific docs win (IDF weighting).
 * @param {{ title: string, category: string | null, tags: string[] }} post
 * @param {{ id: number, technology: string, title: string, url: string, description: string | null, keywords: string[] }[]} docs
 */
export function matchDocs(post, docs, limit = DOCS_LIMIT) {
  const signals = postSignals(post);
  const docFrequency = new Map();
  for (const doc of docs) {
    for (const keyword of new Set(doc.keywords)) docFrequency.set(keyword, (docFrequency.get(keyword) ?? 0) + 1);
  }
  const idf = (keyword) => Math.log(1 + docs.length / docFrequency.get(keyword));

  return docs
    .map((doc) => ({
      doc,
      score: [...new Set(doc.keywords)].reduce((sum, keyword) => sum + keywordWeight(keyword, signals) * idf(keyword), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.doc.id - b.doc.id)
    .slice(0, limit)
    .map(({ doc }) => ({ technology: doc.technology, title: doc.title, url: doc.url, description: doc.description }));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Official doc links for an indexed post, or null when the post isn't indexed.
 * Links only ever come from the curated doc_links table.
 */
export async function relatedDocs(env, postId) {
  const post = await env.DB.prepare("SELECT title, category, tags FROM posts WHERE id = ? AND status = 'indexed'")
    .bind(postId)
    .first();
  if (!post) return null;
  const { results } = await env.DB.prepare('SELECT id, technology, title, url, description, keywords FROM doc_links').all();
  const docs = results.map((row) => ({ ...row, keywords: parseJsonArray(row.keywords).map((k) => k.toLowerCase()) }));
  return matchDocs({ title: post.title, category: post.category, tags: parseJsonArray(post.tags) }, docs);
}
