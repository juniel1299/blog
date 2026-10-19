const CHARS_PER_MINUTE = 500; // rough Korean reading speed (characters, spaces excluded)
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {string} text */
export function readingMinutes(text) {
  return Math.max(1, Math.round(text.replace(/\s+/g, '').length / CHARS_PER_MINUTE));
}

/** dateModified from the post's JSON-LD, only when it is at least a day after datePublished. */
export function modifiedDate(doc = document) {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const { datePublished, dateModified } = JSON.parse(script.textContent);
      const published = Date.parse(datePublished);
      const modified = Date.parse(dateModified);
      if (Number.isFinite(published) && Number.isFinite(modified) && modified - published >= DAY_MS) {
        return new Date(modified);
      }
    } catch {
      // Not the post's JSON-LD (or malformed); keep looking.
    }
  }
  return null;
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())}.`;
}

/**
 * Appends "N분 읽기" and, if edited later, "수정 YYYY. MM. DD." to the post header meta line.
 * @param {HTMLElement | null} meta .post-meta
 * @param {HTMLElement | null} article #article-body
 */
export function initPostMeta(meta, article, doc = document) {
  if (!meta || !article) return;
  const reading = document.createElement('span');
  reading.className = 'post-reading';
  reading.textContent = `${readingMinutes(article.textContent)}분 읽기`;
  meta.append(reading);

  const modified = modifiedDate(doc);
  if (modified) {
    const updated = document.createElement('span');
    updated.className = 'post-updated';
    updated.textContent = `수정 ${formatDate(modified)}`;
    meta.append(updated);
  }
}
