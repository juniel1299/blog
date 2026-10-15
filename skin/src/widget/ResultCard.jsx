/**
 * One search hit: one-line preview, then the post title opening in a new tab.
 * @param {{ result: { title: string, url: string, category: string | null, preview: string } }} props
 */
export function ResultCard({ result }) {
  return (
    <li className="aia-card">
      {result.category && <span className="aia-card-chip">{result.category}</span>}
      {result.preview && <p className="aia-card-preview">{result.preview}</p>}
      <a className="aia-card-link" href={result.url} target="_blank" rel="noopener noreferrer">
        {result.title}
        <span aria-hidden="true"> ↗</span>
        <span className="aia-sr-only"> (새 탭에서 열림)</span>
      </a>
    </li>
  );
}
