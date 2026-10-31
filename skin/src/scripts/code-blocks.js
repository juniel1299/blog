import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';

const COPIED_MS = 2000;
// The languages this blog writes about; only these are bundled and guessed between. TypeScript is left
// out: the JavaScript grammar colors the blog's TSX snippets well enough at a fifth of the weight.
const LANGUAGES = { bash, css, java, javascript, json, python, sql, xml };
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language);
// The post's category narrows the guess: measured on the blog's 190 blocks, Java posts were otherwise
// read as TypeScript and shell commands as SQL. First match wins; "javascript" is checked before "java".
const CATEGORY_LANGUAGES = [
  [/javascript|react|next/i, ['javascript', 'xml', 'bash', 'json']],
  [/java|spring/i, ['java']],
  [/sql|oracle/i, ['sql']],
  [/html|css|퍼블리싱/i, ['xml', 'css', 'javascript']],
  [/^ai$/i, ['bash', 'json', 'javascript', 'python']],
];
const DEFAULT_LANGUAGES = ['bash', 'css', 'java', 'javascript', 'json', 'python', 'sql', 'xml'];
// Below this, highlight.js is guessing (e.g. a single word or a text diagram); leave such code plain.
const MIN_RELEVANCE = 5;

const candidatesFor = (category) => CATEGORY_LANGUAGES.find(([pattern]) => pattern.test(category))?.[1] ?? DEFAULT_LANGUAGES;

/**
 * Colors the code and returns its language name ("" when unknown). Trusts only the new editor's
 * data-ke-language: the old editor's class names are often wrong ("routeros" on bash, "abnf" on Java).
 * highlight.js escapes the source text, so its output is safe to insert.
 */
function highlight(pre, candidates) {
  const code = pre.querySelector('code') ?? pre;
  const text = code.textContent;
  const declared = pre.getAttribute('data-ke-language') ?? '';
  const result = hljs.getLanguage(declared)
    ? hljs.highlight(text, { language: declared, ignoreIllegals: true })
    : hljs.highlightAuto(text, candidates);
  // With a single candidate (Java or SQL posts) there is nothing to confuse it with, so short code counts too.
  const enough = candidates.length === 1 ? result.relevance > 0 : result.relevance >= MIN_RELEVANCE;
  if (!hljs.getLanguage(declared) && !enough) return '';
  code.innerHTML = result.value;
  code.classList.add('hljs');
  return hljs.getLanguage(result.language)?.name ?? '';
}

/**
 * Colors every code block in the post and adds a bar with its language and a copy button above it.
 * The bar sits outside <pre>, so selecting the code by hand never picks up the button text.
 * @param {HTMLElement | null} article
 * @param {{ writeText(text: string): Promise<void> } | undefined} clipboard
 * @param {string} category the post's category ("java", "JavaScript/React"), used to guess unlabeled code
 */
export function initCodeBlocks(article, clipboard = navigator.clipboard, category = '') {
  if (!article) return;
  const candidates = candidatesFor(category.trim());
  for (const pre of article.querySelectorAll('pre')) {
    if (pre.parentElement?.classList.contains('code-block')) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const bar = document.createElement('div');
    bar.className = 'code-bar';
    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = highlight(pre, candidates);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = '복사';
    button.setAttribute('aria-label', '코드 복사');
    button.addEventListener('click', async () => {
      try {
        await clipboard.writeText(pre.innerText);
        button.textContent = '복사됨';
      } catch {
        button.textContent = '복사 실패';
      }
      setTimeout(() => {
        button.textContent = '복사';
      }, COPIED_MS);
    });

    bar.append(label, button);
    pre.before(wrapper);
    wrapper.append(bar, pre);
  }
}
