-- Phase 4-3: Google Search Console rows (search words Google hides from referrers), synced daily by the
-- cron for the last 7 days (Google revises recent days). Aggregated by Google, no visitor data. Rows older
-- than 90 days are deleted by the cron (src/gsc.js).
CREATE TABLE IF NOT EXISTS gsc_rows (
  date TEXT NOT NULL,                     -- "YYYY-MM-DD" (Search Console's Pacific-time day)
  query TEXT NOT NULL,
  page TEXT NOT NULL,                     -- the blog URL Google showed
  post_id INTEGER,                        -- from the URL; null for the home, category pages, ...
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  position REAL NOT NULL,                 -- average rank that day
  PRIMARY KEY (date, query, page)
);
CREATE INDEX IF NOT EXISTS idx_gsc_rows_post ON gsc_rows(post_id, date);
