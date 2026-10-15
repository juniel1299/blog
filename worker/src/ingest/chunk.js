import { normalizeText } from './text.js';

export const MAX_CHUNK_CHARS = 1000;
export const MAX_CHUNKS_PER_POST = 40;

/** Splits text that has no paragraph breaks left into pieces of at most `max` chars, preferring sentence ends. */
function hardSplit(text, max) {
  const pieces = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('다. '), window.lastIndexOf(' '));
    const end = cut > max / 2 ? cut + 1 : max;
    pieces.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Packs paragraphs into chunks of at most `max` chars without splitting a paragraph unless it alone is too long. */
function packParagraphs(text, max) {
  const chunks = [];
  let current = '';
  for (const paragraph of text.split('\n')) {
    for (const piece of paragraph.length > max ? hardSplit(paragraph, max) : [paragraph]) {
      if (current && current.length + 1 + piece.length > max) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Heading-aware chunking: one or more chunks per section, never crossing a heading.
 * @param {{ heading: string | null, text: string }[]} sections in document order
 * @returns {{ position: number, heading: string | null, text: string }[]}
 */
export function chunkSections(sections, { maxChars = MAX_CHUNK_CHARS, maxChunks = MAX_CHUNKS_PER_POST } = {}) {
  return sections
    .flatMap(({ heading, text }) =>
      packParagraphs(normalizeText(text), maxChars).map((chunk) => ({ heading: heading || null, text: chunk })),
    )
    .slice(0, maxChunks)
    .map((chunk, position) => ({ position, ...chunk }));
}
