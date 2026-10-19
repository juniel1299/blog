const COPIED_MS = 2000;
const LANGUAGE = /^[a-z0-9#+.-]{1,20}$/i;

/** Tistory marks code blocks as <pre class="javascript" data-ke-language="javascript">. */
function languageOf(pre) {
  const name = pre.getAttribute('data-ke-language') || pre.classList[0] || '';
  return LANGUAGE.test(name) && name !== 'hljs' ? name : '';
}

/**
 * Adds a bar with the language name and a copy button above every code block in the post.
 * The bar sits outside <pre>, so selecting the code by hand never picks up the button text.
 * @param {HTMLElement | null} article
 * @param {{ writeText(text: string): Promise<void> } | undefined} clipboard
 */
export function initCodeBlocks(article, clipboard = navigator.clipboard) {
  if (!article) return;
  for (const pre of article.querySelectorAll('pre')) {
    if (pre.parentElement?.classList.contains('code-block')) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const bar = document.createElement('div');
    bar.className = 'code-bar';
    const label = document.createElement('span');
    label.className = 'code-lang';
    label.textContent = languageOf(pre);
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
