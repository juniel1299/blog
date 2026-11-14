// "AI 3줄 요약" under the post header, from the summary written when the post was indexed.
/**
 * @param {Element | null} header the post header; the box goes right after it
 * @param {string} apiBase
 * @param {number | null} postId
 */
export async function initSummary(header, apiBase, postId, fetchImpl = fetch) {
  if (!header || !apiBase || !postId) return;
  let summary;
  try {
    const res = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/api/v1/posts/${postId}/summary`);
    if (!res.ok) return;
    ({ summary } = await res.json());
  } catch {
    return; // a nice-to-have; never break the post over it
  }
  if (!Array.isArray(summary) || summary.length === 0) return;

  const box = document.createElement('section');
  box.className = 'ai-summary';
  box.setAttribute('aria-label', 'AI 3줄 요약');
  const title = document.createElement('p');
  title.className = 'ai-summary-title';
  title.textContent = 'AI 3줄 요약';
  const list = document.createElement('ul');
  for (const line of summary) {
    const item = document.createElement('li');
    item.textContent = String(line);
    list.append(item);
  }
  const note = document.createElement('p');
  note.className = 'ai-summary-note';
  note.textContent = 'AI가 이 글 내용으로 만든 요약이에요.';
  box.append(title, list, note);
  header.after(box);
}
