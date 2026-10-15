const URL_BLOCK = /<url>([\s\S]*?)<\/url>/g;
const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/;
const LASTMOD = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Post entries (https://<blog>/<numeric id>) from a Tistory sitemap. Mobile (/m/) and list pages are ignored.
 * @param {string} xml
 * @param {string} origin e.g. https://problem-child.tistory.com
 * @returns {{ id: number, url: string, lastmod: string }[]}
 */
export function parseSitemap(xml, origin) {
  const postUrl = new RegExp(`^${escapeRegExp(origin)}/(\\d+)$`);
  const byId = new Map();
  for (const [, block] of xml.matchAll(URL_BLOCK)) {
    const loc = block.match(LOC)?.[1];
    const match = loc?.match(postUrl);
    if (!match) continue;
    const id = Number(match[1]);
    byId.set(id, { id, url: loc, lastmod: block.match(LASTMOD)?.[1] ?? '' });
  }
  return [...byId.values()];
}

/**
 * Decides what one run should do. Newest changes first; at most `limit` posts are (re)indexed per run
 * to stay inside the Workers free-plan CPU/subrequest limits.
 * @param {{ id: number, url: string, lastmod: string }[]} entries posts currently in the sitemap
 * @param {Map<number, string>} stored post id -> source_lastmod already in D1
 * @param {number} limit
 */
export function planSync(entries, stored, limit) {
  const live = new Set(entries.map((entry) => entry.id));
  // An empty sitemap is far more likely a fetch/parse failure than "every post was deleted".
  const toDelete = entries.length === 0 ? [] : [...stored.keys()].filter((id) => !live.has(id)).slice(0, limit);
  const changed = entries
    .filter((entry) => stored.get(entry.id) !== entry.lastmod)
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod) || b.id - a.id);
  return { toDelete, toIndex: changed.slice(0, limit), remaining: Math.max(changed.length - limit, 0) };
}
