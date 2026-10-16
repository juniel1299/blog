// Chat intents layered on top of plain search: category scope ("리액트 카테고리에서 …") and
// "show recent posts" requests.

// "리액트 카테고리에서 상태관리 글" -> category "리액트", rest "상태관리 글"
const CATEGORY_PHRASE = /(\S+?)\s*카테고리(?:에서|안에서|중에서|에|의|로)?/;
// Korean names for this blog's category path segments (java/Spring, JavaScript/React, SQL(oracle), CS + WEB).
const CATEGORY_ALIASES = new Map([
  ['자바', 'java'], ['스프링', 'spring'], ['자바스크립트', 'javascript'], ['리액트', 'react'],
  ['오라클', 'oracle'], ['에스큐엘', 'sql'], ['웹', 'web'], ['퍼블리싱', '퍼블리싱(html,css)'],
]);
const RECENT_PHRASE = /(최근|최신|요즘|새로\s*올라온|새)\s*(에\s*)?(올라온\s*|쓴\s*)?(글|포스트|게시글|게시물)/;

const segmentWords = (segment) => segment.split(/[^0-9a-z가-힣]+/).filter(Boolean);

/**
 * @param {string} raw
 * @returns {{ category: string | null, rest: string }} category is lowercased (aliases applied)
 */
export function extractCategory(raw) {
  const match = raw.match(CATEGORY_PHRASE);
  if (!match) return { category: null, rest: raw };
  const name = match[1].toLowerCase().replace(/^\[|\]$/g, '');
  return {
    category: CATEGORY_ALIASES.get(name) ?? name,
    rest: `${raw.slice(0, match.index)} ${raw.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim(),
  };
}

/**
 * Whole-segment match against a post's category path, so "java" matches "java/Spring" but not
 * "JavaScript/React", and "oracle" matches "SQL(oracle)".
 */
export function categoryMatches(categoryPath, category) {
  if (!categoryPath || !category) return false;
  return categoryPath
    .toLowerCase()
    .split('/')
    .map((segment) => segment.trim())
    .some((segment) => segment === category || segmentWords(segment).includes(category));
}

/** "최근 글 보여줘", "새로 올라온 글" -> true. Only when nothing else is asked ("최근 리액트 글" is a search). */
export function isRecentRequest(text) {
  const match = text.match(RECENT_PHRASE);
  if (!match) return false;
  const rest = text.replace(match[0], ' ').replace(/(좀|보여\s*줘|보여\s*주세요|알려\s*줘|알려\s*주세요|뭐야|뭐\s*있어|있어|[?.!~\s])/g, '');
  return rest.length === 0;
}
