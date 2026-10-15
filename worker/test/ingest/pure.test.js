import { describe, expect, test } from 'vitest';
import { parseSitemap, planSync } from '../../src/ingest/sitemap.js';
import { decodeEntities, normalizeText } from '../../src/ingest/text.js';
import { chunkSections } from '../../src/ingest/chunk.js';

const ORIGIN = 'https://blog.example.com';
const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>${ORIGIN}</loc><lastmod>2026-10-16T08:00:30+09:00</lastmod></url>
  <url><loc>${ORIGIN}/category/java</loc></url>
  <url><loc>${ORIGIN}/m/123</loc><lastmod>2025-10-08T18:01:13+09:00</lastmod></url>
  <url>
    <loc>${ORIGIN}/123</loc>
    <lastmod>2025-10-08T18:01:13+09:00</lastmod>
  </url>
  <url><loc>${ORIGIN}/122</loc><lastmod>2025-10-06T10:00:00+09:00</lastmod></url>
  <url><loc>https://other.example.com/5</loc><lastmod>2025-01-01</lastmod></url>
</urlset>`;

describe('parseSitemap', () => {
  test('keeps only numeric post URLs on the blog origin', () => {
    expect(parseSitemap(SITEMAP, ORIGIN)).toEqual([
      { id: 123, url: `${ORIGIN}/123`, lastmod: '2025-10-08T18:01:13+09:00' },
      { id: 122, url: `${ORIGIN}/122`, lastmod: '2025-10-06T10:00:00+09:00' },
    ]);
  });

  test('returns nothing for unrelated XML', () => {
    expect(parseSitemap('<html>error</html>', ORIGIN)).toEqual([]);
  });
});

describe('planSync', () => {
  const entries = [
    { id: 1, url: 'u1', lastmod: '2025-01-01' },
    { id: 2, url: 'u2', lastmod: '2025-03-01' },
    { id: 3, url: 'u3', lastmod: '2025-02-01' },
  ];

  test('indexes new and changed posts newest first, up to the limit', () => {
    const stored = new Map([[1, '2025-01-01']]);
    const plan = planSync(entries, stored, 1);
    expect(plan.toIndex.map((e) => e.id)).toEqual([2]);
    expect(plan.remaining).toBe(1);
  });

  test('deletes posts that left the sitemap', () => {
    const stored = new Map([[1, '2025-01-01'], [9, '2024-01-01']]);
    expect(planSync(entries, stored, 3).toDelete).toEqual([9]);
  });

  test('never deletes when the sitemap came back empty', () => {
    const stored = new Map([[1, '2025-01-01']]);
    expect(planSync([], stored, 3).toDelete).toEqual([]);
  });

  test('nothing to do when everything is up to date', () => {
    const stored = new Map(entries.map((e) => [e.id, e.lastmod]));
    expect(planSync(entries, stored, 3)).toEqual({ toDelete: [], toIndex: [], remaining: 0 });
  });
});

describe('text', () => {
  test('decodes common and numeric entities', () => {
    expect(decodeEntities('a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &#x41;&#66;&nbsp;e')).toBe(`a <b> & "c" 'd' AB e`);
  });

  test('leaves unknown or invalid entities alone', () => {
    expect(decodeEntities('&bogus; &#99999999;')).toBe('&bogus; &#99999999;');
  });

  test('normalizes spaces and drops blank lines', () => {
    expect(normalizeText('  a   b \n\n \t \n c ')).toBe('a b\nc');
  });
});

describe('chunkSections', () => {
  test('one chunk per short section, numbered in order, headings kept', () => {
    const chunks = chunkSections([
      { heading: null, text: 'intro' },
      { heading: '인덱스란', text: '  데이터를   빠르게 \n\n 찾는 도구 ' },
      { heading: '빈 섹션', text: '   ' },
    ]);
    expect(chunks).toEqual([
      { position: 0, heading: null, text: 'intro' },
      { position: 1, heading: '인덱스란', text: '데이터를 빠르게\n찾는 도구' },
    ]);
  });

  test('splits long sections on paragraphs, never past maxChars', () => {
    const paragraph = '가'.repeat(60);
    const chunks = chunkSections([{ heading: 'h', text: Array(5).fill(paragraph).join('\n') }], { maxChars: 130 });
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.text.length <= 130 && c.heading === 'h')).toBe(true);
  });

  test('hard-splits a single paragraph longer than maxChars', () => {
    const chunks = chunkSections([{ heading: null, text: 'word '.repeat(100) }], { maxChars: 50 });
    expect(chunks.every((c) => c.text.length <= 50)).toBe(true);
    expect(chunks.map((c) => c.text).join(' ').split(' ').length).toBe(100);
  });

  test('caps the number of chunks per post', () => {
    const sections = Array.from({ length: 10 }, (_, i) => ({ heading: `h${i}`, text: 'x' }));
    expect(chunkSections(sections, { maxChunks: 4 })).toHaveLength(4);
  });
});
