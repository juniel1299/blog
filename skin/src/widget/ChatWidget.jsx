import { useEffect, useId, useRef, useState } from 'react';
import { MAX_QUERY_CHARS, fetchDocs, fetchRecent, fetchSimilar, searchBlog } from './api.js';
import { ResultCard } from './ResultCard.jsx';

const TITLE = '블로그 AI 도우미';
const GREETING = '어떤 글을 찾고 있나요? 아래 예시를 눌러도 돼요.';
const SUGGESTIONS = ['인덱스에 대한 글 찾아줘', '리액트 상태관리 글', '자바 카테고리 글 보여줘', '최근 글 보여줘'];
const NO_DOCS = '이 글과 연결된 공식 문서가 아직 없어요.';
const FALLBACK_ERROR = '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';

let nextId = 0;
const newId = () => `m${(nextId += 1)}`;

/** Lead-in line for a page of results, by how the server understood the question. */
function resultsLabel({ mode, category, results, offset }) {
  const where = mode === 'category' ? `'${category}' 카테고리에서 ` : '';
  if (results.length === 0) {
    return mode === 'category'
      ? `'${category}' 카테고리에서 관련 글을 찾지 못했어요.`
      : '관련 글을 찾지 못했어요. 다른 키워드로 물어봐 주세요.';
  }
  if (offset > 0) return `${where}다음 글 ${results.length}개예요.`;
  if (mode === 'recent') return '최근 글이에요.';
  return `${where}관련 글 ${results.length}개를 찾았어요.`;
}

function DocsAnswer({ message }) {
  if (message.docs.length === 0) return <p className="aia-bubble">{NO_DOCS}</p>;
  return (
    <div className="aia-answer">
      <p className="aia-bubble">'{message.postTitle}' 관련 공식 문서예요.</p>
      <ul className="aia-cards">
        {message.docs.map((doc) => (
          <li key={doc.url} className="aia-card aia-doc">
            <a className="aia-card-link" href={doc.url} target="_blank" rel="noopener noreferrer">
              {doc.title}
              <span aria-hidden="true"> ↗</span>
              <span className="aia-sr-only"> (새 탭에서 열림)</span>
            </a>
            {doc.description && <p className="aia-card-preview">{doc.description}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardsAnswer({ label, results, actions }) {
  if (results.length === 0) return <p className="aia-bubble">{label}</p>;
  return (
    <div className="aia-answer">
      <p className="aia-bubble">{label}</p>
      <ul className="aia-cards">
        {results.map((result) => (
          <ResultCard
            key={result.postId}
            result={result}
            onShowDocs={() => actions.showDocs(result)}
            docsRequested={actions.docsRequested.has(result.postId)}
          />
        ))}
      </ul>
    </div>
  );
}

function AssistantMessage({ message, actions }) {
  if (message.status === 'loading') {
    return (
      <p className="aia-bubble aia-loading" aria-label="불러오는 중">
        <span />
        <span />
        <span />
      </p>
    );
  }
  if (message.status === 'error') return <p className="aia-bubble aia-error">{message.text}</p>;
  if (message.kind === 'docs') return <DocsAnswer message={message} />;
  if (message.kind === 'list') return <CardsAnswer label={message.label} results={message.results} actions={actions} />;
  return (
    <>
      <CardsAnswer label={resultsLabel(message)} results={message.results} actions={actions} />
      {message.hasMore && !message.moreRequested && (
        <button type="button" className="aia-more" onClick={() => actions.showMore(message)}>
          더 보기
        </button>
      )}
    </>
  );
}

/**
 * @param {{ apiBase?: string, currentPostId?: number | null, search?: typeof searchBlog, docs?: typeof fetchDocs,
 *   recent?: typeof fetchRecent, similar?: typeof fetchSimilar }} props
 */
export function ChatWidget({
  apiBase = '',
  currentPostId = null,
  search = searchBlog,
  docs = fetchDocs,
  recent = fetchRecent,
  similar = fetchSimilar,
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [docsRequested, setDocsRequested] = useState(() => new Set());
  const introduced = useRef(false);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const listEndRef = useRef(null);
  const panelId = useId();
  const inputId = useId();
  const ready = Boolean(apiBase);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  /** Appends `before` plus a loading assistant message, then replaces it with run()'s result or an error. */
  async function respond(before, kind, run) {
    const answerId = newId();
    setMessages((list) => [...list, ...before, { id: answerId, role: 'assistant', kind, status: 'loading' }]);
    const settle = (patch) => setMessages((list) => list.map((m) => (m.id === answerId ? { ...m, ...patch } : m)));
    try {
      settle({ status: 'done', ...(await run()) });
    } catch (error) {
      settle({ status: 'error', text: error.message || FALLBACK_ERROR });
    }
  }

  /** First open: posts like the one being read (post pages), else the newest posts. Failures stay quiet. */
  async function introduce() {
    if (introduced.current || !ready) return;
    introduced.current = true;
    await respond([], 'list', async () => {
      if (currentPostId) {
        const like = await similar(apiBase, currentPostId).catch(() => []);
        if (like.length > 0) return { label: '지금 읽는 글과 비슷한 글이에요.', results: like };
      }
      return { label: '최근 글이에요.', results: await recent(apiBase) };
    });
  }

  function toggle() {
    setOpen((value) => !value);
    if (!open) introduce();
  }

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) close();
  }

  async function ask(query) {
    if (!query || pending || !ready) return;
    setInput('');
    setPending(true);
    await respond([{ id: newId(), role: 'user', text: query }], 'results', async () => ({
      query,
      ...(await search(apiBase, query)),
    }));
    setPending(false);
    inputRef.current?.focus();
  }

  const actions = {
    docsRequested,
    showDocs(result) {
      if (docsRequested.has(result.postId)) return;
      setDocsRequested((set) => new Set(set).add(result.postId));
      respond([{ id: newId(), role: 'user', text: `'${result.title}' 관련 문서 보여줘` }], 'docs', async () => ({
        postTitle: result.title,
        docs: await docs(apiBase, result.postId),
      }));
    },
    showMore(message) {
      setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, moreRequested: true } : m)));
      respond([], 'results', async () => ({
        query: message.query,
        ...(await search(apiBase, message.query, { offset: message.offset + message.results.length })),
      }));
    },
  };

  return (
    <div className="aia" onKeyDown={onKeyDown}>
      {open && (
        <section id={panelId} className="aia-panel" role="dialog" aria-label={TITLE}>
          <header className="aia-header">
            <div>
              <h2 className="aia-title">{TITLE}</h2>
              <p className="aia-subtitle">블로그 글을 찾아 한 줄로 알려드려요.</p>
            </div>
            <button type="button" className="aia-close" aria-label="닫기" onClick={close}>
              ×
            </button>
          </header>
          <div className="aia-body" aria-live="polite">
            <p className="aia-bubble">{ready ? GREETING : '준비 중이에요. 곧 글 검색을 지원할 예정입니다.'}</p>
            {ready && (
              <div className="aia-suggestions" role="group" aria-label="예시 질문">
                {SUGGESTIONS.map((text) => (
                  <button key={text} type="button" className="aia-chip" onClick={() => ask(text)} disabled={pending}>
                    {text}
                  </button>
                ))}
              </div>
            )}
            {messages.map((message) =>
              message.role === 'user' ? (
                <p key={message.id} className="aia-bubble aia-user">
                  {message.text}
                </p>
              ) : (
                <AssistantMessage key={message.id} message={message} actions={actions} />
              ),
            )}
            <div ref={listEndRef} />
          </div>
          <form
            className="aia-form"
            onSubmit={(event) => {
              event.preventDefault();
              ask(input.trim());
            }}
          >
            <label className="aia-sr-only" htmlFor={inputId}>
              질문
            </label>
            <input
              id={inputId}
              ref={inputRef}
              value={input}
              maxLength={MAX_QUERY_CHARS}
              onChange={(event) => setInput(event.target.value)}
              placeholder="예: 리액트 카테고리에서 상태관리 글"
              disabled={!ready}
            />
            <button type="submit" disabled={!ready || pending || !input.trim()}>
              전송
            </button>
          </form>
        </section>
      )}
      <button
        ref={launcherRef}
        type="button"
        className="aia-launcher"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'AI 도우미 닫기' : 'AI 도우미 열기'}
        onClick={toggle}
      >
        💬
      </button>
    </div>
  );
}
