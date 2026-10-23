// "이 글과 비슷한 글" at the end of a post, from the same similar-posts API the chat widget uses.
import { fetchSimilar } from '../widget/api.js';

const LIMIT = 3;

function item(post) {
  const li = document.createElement('li');
  if (post.category) {
    const chip = document.createElement('span');
    chip.className = 'similar-chip';
    chip.textContent = post.category;
    li.append(chip);
  }
  const link = document.createElement('a');
  link.className = 'similar-title';
  link.href = post.url;
  link.textContent = post.title;
  li.append(link);
  if (post.preview) {
    const preview = document.createElement('p');
    preview.className = 'similar-preview';
    preview.textContent = post.preview;
    li.append(preview);
  }
  return li;
}

/**
 * @param {Element | null} nav the previous/next post links; the box goes right above it
 * @param {string} apiBase
 * @param {number | null} postId
 */
export async function initSimilar(nav, apiBase, postId, similar = fetchSimilar) {
  if (!nav || !apiBase || !postId) return;
  let posts;
  try {
    posts = (await similar(apiBase, postId)).slice(0, LIMIT);
  } catch {
    return; // a nice-to-have; never break the post over it
  }
  if (posts.length === 0) return;
  const box = document.createElement('section');
  box.className = 'similar';
  box.setAttribute('aria-label', '이 글과 비슷한 글');
  const title = document.createElement('h2');
  title.textContent = '이 글과 비슷한 글';
  const list = document.createElement('ul');
  list.append(...posts.map(item));
  box.append(title, list);
  nav.before(box);
}
