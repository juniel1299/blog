const isHttpUrl = (url) => /^https?:\/\//.test(url);

function link(post, className, text) {
  const a = document.createElement('a');
  a.className = className;
  a.href = post.url;
  a.textContent = text;
  return a;
}

/**
 * Builds the series box: collapsible episode list + previous/next episode links. textContent only.
 * @param {{ name: string, posts: { postId: number, title: string, url: string }[] }} series
 * @param {number} postId current post
 * @returns {HTMLElement | null}
 */
export function renderSeries(series, postId) {
  const posts = series.posts.filter((post) => isHttpUrl(post.url));
  const index = posts.findIndex((post) => post.postId === postId);
  if (posts.length < 2 || index < 0) return null;

  const nav = document.createElement('nav');
  nav.className = 'series';
  nav.setAttribute('aria-label', `${series.name} 시리즈`);

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'series-name';
  name.textContent = `${series.name} 시리즈`;
  const position = document.createElement('span');
  position.className = 'series-pos';
  position.textContent = `${index + 1} / ${posts.length}`;
  summary.append(name, position);

  const list = document.createElement('ol');
  list.className = 'series-list';
  for (const post of posts) {
    const item = document.createElement('li');
    const a = link(post, '', post.title);
    if (post.postId === postId) a.setAttribute('aria-current', 'page');
    item.append(a);
    list.append(item);
  }
  details.append(summary, list);

  const steps = document.createElement('div');
  steps.className = 'series-steps';
  if (index > 0) steps.append(link(posts[index - 1], 'series-prev', `← ${posts[index - 1].title}`));
  if (index < posts.length - 1) steps.append(link(posts[index + 1], 'series-next', `${posts[index + 1].title} →`));

  nav.append(details, steps);
  return nav;
}

/**
 * On a post page that belongs to a series, inserts the series box under the post header.
 * Quietly does nothing when the API is unset, the post has no series, or the request fails.
 * @param {HTMLElement | null} header .post-header
 * @param {string} apiBase
 * @param {number | null} postId
 */
export async function initSeries(header, apiBase, postId, fetchImpl = fetch) {
  if (!header || !apiBase || !postId) return;
  try {
    const res = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/api/v1/posts/${postId}/series`);
    if (!res.ok) return;
    const { series } = await res.json();
    const box = series && renderSeries(series, postId);
    if (box) header.after(box);
  } catch {
    // Series is a nice-to-have; never break the page over it.
  }
}
