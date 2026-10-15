const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTMLRewriter hands over raw (still-escaped) text, so decode the entities blog posts actually contain. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#x')) return safeCodePoint(parseInt(lower.slice(2), 16), whole);
    if (lower.startsWith('#') && lower !== '#39') return safeCodePoint(Number(lower.slice(1)), whole);
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function safeCodePoint(code, fallback) {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

/** Collapses runs of spaces inside lines and drops blank lines. */
export function normalizeText(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
