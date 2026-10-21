/**
 * One search hit: one-line preview, the post title opening in a new tab, and a button that asks
 * the assistant for related official docs.
 * @param {{ result: { title: string, url: string, category: string | null, preview: string },
 *   onShowDocs?: () => void, docsRequested?: boolean, number?: number }} props  number: source number in an AI answer
 */
export function ResultCard({ result, onShowDocs, docsRequested = false, number }) {
  return (
    <li className="aia-card">
      {number && <span className="aia-card-num">[{number}]</span>}
      {result.category && <span className="aia-card-chip">{result.category}</span>}
      {result.preview && <p className="aia-card-preview">{result.preview}</p>}
      <a className="aia-card-link" href={result.url} target="_blank" rel="noopener noreferrer">
        {result.title}
        <span aria-hidden="true"> ↗</span>
        <span className="aia-sr-only"> (새 탭에서 열림)</span>
      </a>
      {onShowDocs && (
        <button
          type="button"
          className="aia-card-docs"
          onClick={onShowDocs}
          disabled={docsRequested}
          aria-label={`'${result.title}' 관련 공식 문서 보기`}
        >
          관련 문서
        </button>
      )}
    </li>
  );
}
