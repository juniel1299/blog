import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatWidget } from '../src/widget/ChatWidget.jsx';
import { SearchError, fetchDocs, isSafeUrl, searchBlog } from '../src/widget/api.js';
import { mountWidget } from '../src/widget/mount.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const API = 'https://api.example.com';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function openWith(search) {
  render(<ChatWidget apiBase={API} search={search} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
}

async function ask(text) {
  fireEvent.change(screen.getByLabelText('질문'), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '전송' }));
  });
}

describe('ChatWidget', () => {
  test('opens and closes from the launcher', () => {
    render(<ChatWidget apiBase={API} />);
    const launcher = screen.getByRole('button', { name: 'AI 도우미 열기' });

    fireEvent.click(launcher);
    expect(screen.getByRole('dialog', { name: '블로그 AI 도우미' })).toBeTruthy();
    expect(launcher.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Escape closes and returns focus to the launcher', () => {
    render(<ChatWidget apiBase={API} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
    const input = screen.getByLabelText('질문');
    expect(document.activeElement).toBe(input);

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
    const search = vi.fn(async () => [
      { postId: 122, title: 'Index 란?', url: 'https://blog/122', category: 'SQL', preview: '인덱스는 빠르게 찾는 도구' },
    ]);
    openWith(search);

    await ask('  인덱스 글 찾아줘 ');

    expect(search).toHaveBeenCalledWith(API, '인덱스 글 찾아줘');
    expect(screen.getByText('인덱스 글 찾아줘')).toBeTruthy();
    expect(screen.getByText('인덱스는 빠르게 찾는 도구')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Index 란\?/ });
    expect(link.getAttribute('href')).toBe('https://blog/122');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByLabelText('질문').value).toBe('');
  });

  test('no results shows a "not found" message instead of cards', async () => {
    openWith(vi.fn(async () => []));
    await ask('김치찌개 레시피');
    expect(screen.getByText(/관련 글을 찾지 못했어요/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('errors are shown as a message and the user can ask again', async () => {
    const search = vi.fn().mockRejectedValueOnce(new SearchError('rate', '질문이 너무 많아요.')).mockResolvedValue([]);
    openWith(search);
    await ask('react');
    expect(screen.getByText('질문이 너무 많아요.')).toBeTruthy();
    await ask('react');
    expect(search).toHaveBeenCalledTimes(2);
  });

  test('"관련 문서" adds official doc links for that post, once', async () => {
    const docs = vi.fn(async () => [
      { technology: 'react', title: '리스트 렌더링', url: 'https://ko.react.dev/learn/rendering-lists', description: 'map과 key' },
    ]);
    render(
      <ChatWidget
        apiBase={API}
        search={async () => [{ postId: 123, title: 'map vs forEach', url: 'https://blog/123', category: 'React', preview: 'p' }]}
        docs={docs}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
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
    render(
      <ChatWidget
        apiBase={API}
        search={async () => [{ postId: 106, title: '입사 일기', url: 'https://blog/106', category: null, preview: 'p' }]}
        docs={async () => []}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'AI 도우미 열기' }));
    await ask('입사');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "'입사 일기' 관련 공식 문서 보기" }));
    });
    expect(screen.getByText('이 글과 연결된 공식 문서가 아직 없어요.')).toBeTruthy();
  });

  test('blank input is not sent', async () => {
    const search = vi.fn();
    openWith(search);
    fireEvent.change(screen.getByLabelText('질문'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '전송' }).disabled).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });
});

describe('searchBlog', () => {
  const respond = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  test('posts the query and drops results with unsafe links', async () => {
    const fetchImpl = respond(200, {
      results: [
        { postId: 1, title: 'ok', url: 'https://blog/1' },
        { postId: 2, title: 'bad', url: 'javascript:alert(1)' },
      ],
    });
    const results = await searchBlog(`${API}/`, 'react', { fetchImpl });
    expect(results.map((r) => r.postId)).toEqual([1]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${API}/api/v1/search`);
    expect(JSON.parse(init.body)).toEqual({ query: 'react' });
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

  test('fetchDocs GETs the post docs and drops unsafe links', async () => {
    const fetchImpl = respond(200, {
      docs: [
        { title: 'CORS', url: 'https://developer.mozilla.org/x' },
        { title: 'bad', url: 'javascript:void 0' },
      ],
    });
    const docs = await fetchDocs(API, 101, { fetchImpl });
    expect(docs.map((d) => d.title)).toEqual(['CORS']);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API}/api/v1/posts/101/docs`);
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
});
