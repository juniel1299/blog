import { useEffect, useId, useRef, useState } from 'react';

const TITLE = '블로그 AI 도우미';

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const panelId = useId();
  const inputId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) close();
  }

  return (
    <div className="aia" onKeyDown={onKeyDown}>
      {open && (
        <section id={panelId} className="aia-panel" role="dialog" aria-label={TITLE}>
          <header className="aia-header">
            <div>
              <h2 className="aia-title">{TITLE}</h2>
              <p className="aia-subtitle">블로그 글을 찾고 관련 공식 문서를 알려드려요.</p>
            </div>
            <button type="button" className="aia-close" aria-label="닫기" onClick={close}>
              ×
            </button>
          </header>
          <div className="aia-body">
            {/* Phase 0: no backend yet, so no answers (real or fake) are shown. */}
            <p className="aia-notice" role="status">
              준비 중이에요. 곧 글 검색을 지원할 예정입니다.
            </p>
          </div>
          <form className="aia-form" onSubmit={(event) => event.preventDefault()}>
            <label className="aia-sr-only" htmlFor={inputId}>
              질문
            </label>
            <input id={inputId} ref={inputRef} placeholder="예: PostgreSQL 인덱스 글 찾아줘" />
            <button type="submit" disabled>
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
