import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatWidget } from '../src/widget/ChatWidget.jsx';
import { SearchError, fetchDocs, fetchRecent, fetchSimilar, isSafeUrl, searchBlog } from '../src/widget/api.js';
import { currentPostId, mountWidget } from '../src/widget/mount.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const API = 'https://api.example.com';

const card = (postId, title, extra = {}) => ({ postId, title, url: `https://blog/${postId}`, category: 'React', preview: `p${postId}`, ...extra });
const page = (results, extra = {}) => ({ mode: 'search', category: null, offset: 0, hasMore: false, results, ...extra });

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** Renders and opens the widget; the opening "recent/similar" intro resolves before returning. */
async function openWith(props = {}) {
  render(<ChatWidget apiBase={API} recent={async () => []} similar={async () => []} {...props} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
  });
}

async function ask(text) {
  fireEvent.change(screen.getByLabelText('질문'), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '전송' }));
  });
}

describe('ChatWidget', () => {
  test('opens and closes from the launcher', async () => {
    await openWith();
    const launcher = screen.getByRole('button', { name: 'AI 도우미 닫기' });
    expect(screen.getByRole('dialog', { name: '블로그 AI 도우미' })).toBeTruthy();
    expect(launcher.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Escape closes and returns focus to the launcher', async () => {
    await openWith();
    const input = screen.getByLabelText('질문');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'AI 도우미 열기' }));
  });

  test('without an API base it shows a not-ready notice and disables input', () => {
    render(<ChatWidget />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
    expect(screen.getByRole('dialog').textContent).toContain('준비 중');
    expect(screen.getByLabelText('질문').disabled).toBe(true);
    expect(screen.getByRole('button', { name: '전송' }).disabled).toBe(true);
  });

  test('asking shows the question, then result cards with preview and a new-tab title link', async () => {
    const search = vi.fn(async () => page([card(122, 'Index 란?', { preview: '인덱스는 빠르게 찾는 도구' })]));
    await openWith({ search });

    await ask('  인덱스 글 찾아줘 ');

    expect(search).toHaveBeenCalledWith(API, '인덱스 글 찾아줘');
    expect(screen.getByText('관련 글 1개를 찾았어요.')).toBeTruthy();
    expect(screen.getByText('인덱스는 빠르게 찾는 도구')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Index 란\?/ });
    expect(link.getAttribute('href')).toBe('https://blog/122');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByLabelText('질문').value).toBe('');
  });

  test('no results shows a "not found" message instead of cards', async () => {
    await openWith({ search: async () => page([]) });
    await ask('김치찌개 레시피');
    expect(screen.getByText(/관련 글을 찾지 못했어요/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('category answers say which category was searched', async () => {
    await openWith({ search: async () => page([card(119, 'Redux vs Zustand')], { mode: 'category', category: 'react' }) });
    await ask('리액트 카테고리에서 상태관리');
    expect(screen.getByText("'react' 카테고리에서 관련 글 1개를 찾았어요.")).toBeTruthy();
  });

  test('"더 보기" loads the next page once', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce(page([card(1, 'a'), card(2, 'b'), card(3, 'c')], { hasMore: true }))
      .mockResolvedValueOnce(page([card(4, 'd')], { offset: 3 }));
    await openWith({ search });
    await ask('리액트 훅');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '더 보기' }));
    });

    expect(search).toHaveBeenLastCalledWith(API, '리액트 훅', { offset: 3 });
    expect(screen.getByText('다음 글 1개예요.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^d/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '더 보기' })).toBeNull();
  });

  test('errors are shown as a message and the user can ask again', async () => {
    const search = vi.fn().mockRejectedValueOnce(new SearchError('rate', '질문이 너무 많아요.')).mockResolvedValue(page([]));
    await openWith({ search });
    await ask('react');
    expect(screen.getByText('질문이 너무 많아요.')).toBeTruthy();
    await ask('react');
    expect(search).toHaveBeenCalledTimes(2);
  });

  test('suggestion chips ask their question', async () => {
    const search = vi.fn(async () => page([]));
    await openWith({ search });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '최근 글 보여줘' }));
    });
    expect(search).toHaveBeenCalledWith(API, '최근 글 보여줘');
  });

  test('opening off a post page shows recent posts once', async () => {
    const recent = vi.fn(async () => [card(123, 'map vs forEach')]);
    await openWith({ recent });
    expect(screen.getByText('최근 글이에요.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /map vs forEach/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
    });
    expect(recent).toHaveBeenCalledTimes(1);
  });

  test('opening on a post page shows similar posts, falling back to recent when there are none', async () => {
    const similar = vi.fn(async () => [card(95, 'useRef')]);
    await openWith({ currentPostId: 98, similar });
    expect(similar).toHaveBeenCalledWith(API, 98);
    expect(screen.getByText('지금 읽는 글과 비슷한 글이에요.')).toBeTruthy();

    cleanup();
    await openWith({ currentPostId: 98, similar: async () => [], recent: async () => [card(1, 'new')] });
    expect(screen.getByText('최근 글이에요.')).toBeTruthy();
  });

  test('"관련 문서" adds official doc links for that post, once', async () => {
    const docs = vi.fn(async () => [
      { technology: 'react', title: '리스트 렌더링', url: 'https://ko.react.dev/learn/rendering-lists', description: 'map과 key' },
    ]);
    await openWith({ search: async () => page([card(123, 'map vs forEach')]), docs });
    await ask('map 글');

    const button = screen.getByRole('button', { name: "'map vs forEach' 관련 공식 문서 보기" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(docs).toHaveBeenCalledWith(API, 123);
    expect(screen.getByText("'map vs forEach' 관련 공식 문서예요.")).toBeTruthy();
    const link = screen.getByRole('link', { name: /리스트 렌더링/ });
    expect(link.getAttribute('href')).toBe('https://ko.react.dev/learn/rendering-lists');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(button.disabled).toBe(true);
  });

  test('a post without linked docs says so', async () => {
    await openWith({ search: async () => page([card(106, '입사 일기', { category: null })]), docs: async () => [] });
    await ask('입사');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "'입사 일기' 관련 공식 문서 보기" }));
    });
    expect(screen.getByText('이 글과 연결된 공식 문서가 아직 없어요.')).toBeTruthy();
  });

  test('blank input is not sent', async () => {
    const search = vi.fn();
    await openWith({ search });
    fireEvent.change(screen.getByLabelText('질문'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '전송' }).disabled).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('api client', () => {
  const respond = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  test('searchBlog posts query + offset, keeps paging fields, drops unsafe links', async () => {
    const fetchImpl = respond(200, {
      mode: 'category',
      category: 'react',
      offset: 3,
      hasMore: false,
      results: [
        { postId: 1, title: 'ok', url: 'https://blog/1' },
        { postId: 2, title: 'bad', url: 'javascript:alert(1)' },
      ],
    });
    const answer = await searchBlog(`${API}/`, 'react', { offset: 3, fetchImpl });
    expect(answer).toMatchObject({ mode: 'category', category: 'react', offset: 3, hasMore: false });
    expect(answer.results.map((r) => r.postId)).toEqual([1]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${API}/api/v1/search`);
    expect(JSON.parse(init.body)).toEqual({ query: 'react', offset: 3 });
  });

  test.each([
    [429, 'rate'],
    [500, 'server'],
  ])('HTTP %i becomes a %s error', async (status, kind) => {
    await expect(searchBlog(API, 'q', { fetchImpl: respond(status, {}) })).rejects.toMatchObject({ kind });
  });

  test('network failure becomes a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(searchBlog(API, 'q', { fetchImpl })).rejects.toMatchObject({ kind: 'network' });
  });

  test('fetchDocs / fetchRecent / fetchSimilar hit their paths and drop unsafe links', async () => {
    const docsFetch = respond(200, { docs: [{ title: 'CORS', url: 'https://developer.mozilla.org/x' }, { title: 'bad', url: 'javascript:void 0' }] });
    expect((await fetchDocs(API, 101, { fetchImpl: docsFetch })).map((d) => d.title)).toEqual(['CORS']);
    expect(docsFetch.mock.calls[0][0]).toBe(`${API}/api/v1/posts/101/docs`);

    const recentFetch = respond(200, { posts: [{ postId: 1, title: 'r', url: 'https://blog/1' }] });
    expect(await fetchRecent(API, { fetchImpl: recentFetch })).toHaveLength(1);
    expect(recentFetch.mock.calls[0][0]).toBe(`${API}/api/v1/posts/recent`);

    const similarFetch = respond(200, { posts: [{ postId: 2, title: 's', url: 'javascript:x' }] });
    expect(await fetchSimilar(API, 98, { fetchImpl: similarFetch })).toEqual([]);
    expect(similarFetch.mock.calls[0][0]).toBe(`${API}/api/v1/posts/98/similar`);
  });

  test('isSafeUrl only allows http(s)', () => {
    expect(isSafeUrl('https://a.b/c')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
  });
});

describe('mountWidget', () => {
  test('mounts once per element', async () => {
    const element = document.createElement('div');
    document.body.append(element);

    let first;
    await act(async () => {
      first = mountWidget(element);
    });
    const second = mountWidget(element);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(element.querySelectorAll('.aia-launcher')).toHaveLength(1);
    await act(async () => first.unmount());
  });

  test('missing element is a no-op', () => {
    expect(mountWidget(null)).toBeNull();
  });

  test('currentPostId reads the post number only on post pages', () => {
    expect(currentPostId({ pathname: '/123' }, 'tt-body-page')).toBe(123);
    expect(currentPostId({ pathname: '/123/' }, 'tt-body-page')).toBe(123);
    expect(currentPostId({ pathname: '/category/java' }, 'tt-body-page')).toBeNull();
    expect(currentPostId({ pathname: '/123' }, 'tt-body-index')).toBeNull();
  });
});
