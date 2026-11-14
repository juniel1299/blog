import { afterEach, describe, expect, test, vi } from 'vitest';
import { initSummary } from '../src/scripts/summary.js';

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

function page() {
  document.body.innerHTML = '<header class="post-header"></header><nav class="series"></nav><div id="article-body"></div>';
  return document.querySelector('.post-header');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('initSummary', () => {
  test('shows the 3 lines right under the post header, above the series box', async () => {
    const header = page();
    const fetchImpl = vi.fn(async () => ok({ summary: ['하나.', '<b>둘</b>.', '셋.'] }));
    await initSummary(header, 'https://api/', 98, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('https://api/api/v1/posts/98/summary');
    const box = header.nextElementSibling;
    expect(box.className).toBe('ai-summary');
    expect([...box.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['하나.', '<b>둘</b>.', '셋.']);
    expect(box.querySelector('b')).toBeNull();
    expect(box.nextElementSibling.className).toBe('series');
  });

  test('no summary yet, an API failure, or a non-post page adds nothing', async () => {
    const header = page();
    await initSummary(header, 'https://api', 98, async () => ok({ summary: null }));
    await initSummary(header, 'https://api', 98, async () => new Response('', { status: 404 }));
    await initSummary(header, 'https://api', 98, async () => {
      throw new Error('down');
    });
    await initSummary(header, 'https://api', null, vi.fn());
    await initSummary(header, '', 98, vi.fn());
    expect(document.querySelector('.ai-summary')).toBeNull();
  });
});
