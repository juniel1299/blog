export const MAX_QUERY_CHARS = 200;
const TRIGRAM_MIN = 3; // FTS5 trigram can only match terms of 3+ characters
const MAX_TERMS = 8;

// "PostgreSQL 인덱스에 대한 글 찾아줘" -> "PostgreSQL 인덱스". Order matters: longest phrases first.
const REQUEST_SUFFIXES = [
  /(에\s*)?(대한|대해서|대해|관한|관련된|관련)\s*/g,
  /(글|포스트|게시글|게시물|내용|자료)(을|를|이|가)?\s*/g,
  /(좀\s*)?(찾아\s*줘|찾아\s*주세요|찾아줄래|찾아봐|알려\s*줘|알려\s*주세요|보여\s*줘|보여\s*주세요|추천해\s*줘|있어|있나요|있니)\s*[.?!~]*/g,
];
const PARTICLES = /(에서|으로|이란|이랑|에게|은|는|이|가|을|를|에|의|로|와|과|란|도|만)$/;

/** "인덱스란" -> "인덱스". Words of 2 chars or less are left alone ("조인" must stay "조인"). */
export function stripParticle(word) {
  return word.length > 2 ? word.replace(PARTICLES, '') : word;
}
// Generic words that appear in many post titles ("... 차이", "... 정리") and would match everything.
const STOPWORDS = new Set([
  '어떤', '무슨', '관련', '대한', '그', '이', '저', '좀', '방법', '뭐야', '뭐',
  '차이', '차이점', '정리', '개념', '비교', '사용법', '예제', 'vs',
]);

/**
 * Turns a chat-style request into search inputs.
 * @param {string} raw user input
 * @returns {{ text: string, terms: string[], ftsQuery: string | null, likeTerms: string[] }}
 *   text: cleaned query for embedding; ftsQuery: FTS5 MATCH expression (3+ char terms);
 *   likeTerms: shorter terms (e.g. "조인") that trigram cannot match, searched with LIKE.
 */
export function parseQuery(raw) {
  let text = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  for (const pattern of REQUEST_SUFFIXES) text = text.replace(pattern, ' ');
  text = text.replace(/\s+/g, ' ').trim() || raw.trim();

  const terms = [
    ...new Set(
      text
        .split(/[\s,.;:!?"'()[\]{}<>/\\|`~^*+=]+/)
        .map((word) => stripParticle(word).toLowerCase())
        .filter((word) => word.length >= 2 && !STOPWORDS.has(word)),
    ),
  ].slice(0, MAX_TERMS);

  const ftsTerms = terms.filter((term) => term.length >= TRIGRAM_MIN);
  return {
    text,
    terms,
    // Quoted phrases so FTS5 operators/punctuation in user input are treated as plain text.
    ftsQuery: ftsTerms.length > 0 ? ftsTerms.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ') : null,
    likeTerms: terms.filter((term) => term.length < TRIGRAM_MIN),
  };
}

const SNIPPET_CHARS = 120;
const MIN_SENTENCE_CHARS = 15; // shorter lines are usually code ("SELECT *") or labels

const CODE_LIKE = /[{};]|=>|^\s*(const|let|var|function|import|return|select|from|where)\b/i;
const HANGUL = /[가-힣]/;

/**
 * One-line extractive preview, most readable line first: Korean prose mentioning a query term,
 * any Korean prose, any sentence-length line mentioning a term, any sentence, whatever comes first.
 */
export function makeSnippet(text, terms, max = SNIPPET_CHARS) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sentences = lines.filter((line) => line.length >= MIN_SENTENCE_CHARS);
  const prose = sentences.filter((line) => HANGUL.test(line) && !CODE_LIKE.test(line));
  const lower = terms.map((term) => term.toLowerCase());
  const mentions = (line) => lower.some((term) => line.toLowerCase().includes(term));
  const line =
    prose.find(mentions) ?? prose[0] ?? sentences.find(mentions) ?? sentences[0] ?? lines.find(mentions) ?? lines[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
