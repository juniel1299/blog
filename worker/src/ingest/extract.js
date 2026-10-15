/* global HTMLRewriter -- Workers runtime built-in */
import { decodeEntities } from './text.js';

// Text inside these never belongs in the index. Tistory injects ads, like/share buttons and a
// "카테고리의 다른 글" list into the post body.
const SKIPPED = [
  'script', 'style', 'noscript', 'iframe', 'ins', 'svg', 'button', 'figcaption',
  '.another_category', '.container_postbtn', '.layer_post', '.revenue_unit_wrap',
];
const BLOCK_TAGS = ['p', 'div', 'li', 'pre', 'br', 'tr', 'blockquote', 'figure', 'table', 'ul', 'ol'];
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4'];
const BODY = '#article-body';

/**
 * Pulls post metadata and heading-delimited body sections out of a post page rendered by this repo's skin.
 * Runs on the Workers HTMLRewriter (streaming, native), which keeps CPU time low on the free plan.
 * @param {Response} response
 * @returns {Promise<{ title: string, category: string, tags: string[], summary: string,
 *   publishedAt: string | null, sections: { heading: string | null, text: string }[] }>}
 */
export async function extractPost(response) {
  let title = '';
  let category = '';
  let summary = '';
  let jsonLd = '';
  const tags = [];
  const sections = [{ heading: null, text: '' }];
  let headingText = null;
  let skipDepth = 0;

  const current = () => sections[sections.length - 1];
  const append = (text) => {
    if (skipDepth > 0) return;
    if (headingText !== null) headingText += text;
    else current().text += text;
  };

  let rewriter = new HTMLRewriter()
    .on('h1.post-title', { text: (t) => { title += t.text; } })
    .on('.post-header .chip', { text: (t) => { category += t.text; } })
    .on('.post-tags a', {
      element: () => { tags.push(''); },
      text: (t) => { tags[tags.length - 1] += t.text; },
    })
    .on('meta[property="og:description"]', { element: (e) => { summary = e.getAttribute('content') ?? ''; } })
    .on('script[type="application/ld+json"]', { text: (t) => { jsonLd += t.text; } })
    .on(BODY, { text: (t) => append(t.text) });

  for (const selector of SKIPPED) {
    rewriter = rewriter.on(`${BODY} ${selector}`, {
      element: (e) => {
        skipDepth += 1;
        e.onEndTag(() => { skipDepth -= 1; });
      },
    });
  }
  for (const tag of BLOCK_TAGS) {
    rewriter = rewriter.on(`${BODY} ${tag}`, { element: () => append('\n') });
  }
  for (const tag of HEADING_TAGS) {
    rewriter = rewriter.on(`${BODY} ${tag}`, {
      element: (e) => {
        if (skipDepth > 0) return;
        headingText = '';
        e.onEndTag(() => {
          sections.push({ heading: decodeEntities(headingText).replace(/\s+/g, ' ').trim(), text: '' });
          headingText = null;
        });
      },
    });
  }

  // Drain the transformed stream; we only care about the handler side effects.
  await rewriter.transform(response).arrayBuffer();

  return {
    title: decodeEntities(title).trim(),
    category: decodeEntities(category).trim(),
    tags: tags.map((tag) => decodeEntities(tag).trim()).filter(Boolean),
    summary: decodeEntities(summary).trim(),
    publishedAt: readPublishedAt(jsonLd),
    sections: sections.map((s) => ({ heading: s.heading, text: decodeEntities(s.text) })),
  };
}

function readPublishedAt(jsonLd) {
  try {
    const value = JSON.parse(jsonLd)?.datePublished;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
