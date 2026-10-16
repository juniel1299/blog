import { useEffect, useId, useRef, useState } from 'react';
import { MAX_QUERY_CHARS, fetchDocs, searchBlog } from './api.js';
import { ResultCard } from './ResultCard.jsx';

const TITLE = '블로그 AI 도우미';
const GREETING = '어떤 글을 찾고 있나요? 예: "인덱스에 대한 글 찾아줘"';
const EMPTY = '관련 글을 찾지 못했어요. 다른 키워드로 물어봐 주세요.';
const NO_DOCS = '이 글과 연결된 공식 문서가 아직 없어요.';
const FALLBACK_ERROR = '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';

let nextId = 0;
const newId = () => `m${(nextId += 1)}`;

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

function AssistantMessage({ message, onShowDocs, docsRequested }) {
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
  if (message.results.length === 0) return <p className="aia-bubble">{EMPTY}</p>;
  return (
    <div className="aia-answer">
      <p className="aia-bubble">관련 글 {message.results.length}개를 찾았어요.</p>
      <ul className="aia-cards">
        {message.results.map((result) => (
          <ResultCard
            key={result.postId}
            result={result}
            onShowDocs={() => onShowDocs(result)}
            docsRequested={docsRequested.has(result.postId)}
          />
        ))}
      </ul>
    </div>
  );
}

/** @param {{ apiBase?: string, search?: typeof searchBlog, docs?: typeof fetchDocs }} props */
export function ChatWidget({ apiBase = '', search = searchBlog, docs = fetchDocs }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [docsRequested, setDocsRequested] = useState(() => new Set());
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

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) close();
  }

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

  async function onSubmit(event) {
    event.preventDefault();
    const query = input.trim();
    if (!query || pending || !ready) return;

    setInput('');
    setPending(true);
    await respond([{ id: newId(), role: 'user', text: query }], 'results', async () => ({
      results: await search(apiBase, query),
    }));
    setPending(false);
    inputRef.current?.focus();
  }

  function onShowDocs(result) {
    if (docsRequested.has(result.postId)) return;
    setDocsRequested((set) => new Set(set).add(result.postId));
    respond([{ id: newId(), role: 'user', text: `'${result.title}' 관련 문서 보여줘` }], 'docs', async () => ({
      postTitle: result.title,
      docs: await docs(apiBase, result.postId),
    }));
  }

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
            {messages.map((message) =>
              message.role === 'user' ? (
                <p key={message.id} className="aia-bubble aia-user">
                  {message.text}
                </p>
              ) : (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  onShowDocs={onShowDocs}
                  docsRequested={docsRequested}
                />
              ),
            )}
            <div ref={listEndRef} />
          </div>
          <form className="aia-form" onSubmit={onSubmit}>
            <label className="aia-sr-only" htmlFor={inputId}>
              질문
            </label>
            <input
              id={inputId}
              ref={inputRef}
              value={input}
              maxLength={MAX_QUERY_CHARS}
              onChange={(event) => setInput(event.target.value)}
              placeholder="예: 리액트 상태관리 글 찾아줘"
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
        onClick={() => setOpen((value) => !value)}
      >
        💬
      </button>
    </div>
  );
}
