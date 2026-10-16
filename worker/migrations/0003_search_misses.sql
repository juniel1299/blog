-- Questions that found no post, to see which topics/keywords the blog or the search is missing.
-- Privacy: only the normalized question text is stored (no IP, user agent or any identifier),
-- and rows older than 90 days are deleted by the cron (src/misses.js).
CREATE TABLE IF NOT EXISTS search_misses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,                              -- lowercased, spaces collapsed, <= 200 chars
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_misses_created ON search_misses(created_at);
