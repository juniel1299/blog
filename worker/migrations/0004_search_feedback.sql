-- 👍/👎 on a page of chat search results, to find questions the search answers badly.
-- Privacy: only the normalized question, the vote and the shown post ids are stored (no IP, user agent
-- or any identifier), and rows older than 90 days are deleted by the cron (src/feedback.js).
CREATE TABLE IF NOT EXISTS search_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,                              -- lowercased, spaces collapsed, <= 200 chars
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  post_ids TEXT NOT NULL,                           -- JSON array of the 1-3 post ids that were shown
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_feedback_created ON search_feedback(created_at);
