-- Phase 3 analytics for the insight dashboard (docs/data-model.md).
-- Privacy: no IP, user agent, cookie or any visitor identifier. Referrers keep only the host and, for
-- search engines, the search words. The blog owner's own visits are not sent. Rows older than 90 days
-- are deleted by the cron (src/events.js).

-- One row per page visit, sent once when the visitor leaves (navigator.sendBeacon).
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,                     -- "/98", "/category/java", "/"
  post_id INTEGER,                        -- null on non-post pages
  referrer_host TEXT,                     -- null = direct, "internal" = from this blog
  search_engine TEXT,                     -- naver | daum | google | bing | zum | duckduckgo
  search_query TEXT,                      -- search words from the referrer, <= 100 chars
  depth INTEGER NOT NULL CHECK (depth IN (0, 25, 50, 75, 100)),  -- furthest scroll through the post body
  seconds INTEGER NOT NULL,               -- time visible on screen
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_post ON page_views(post_id, created_at);

-- A post card clicked in the chat widget or the header search.
CREATE TABLE IF NOT EXISTS result_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  position INTEGER NOT NULL,              -- 1-based rank in the list that was shown
  source TEXT NOT NULL CHECK (source IN ('chat', 'answer', 'list', 'header')),
  query TEXT,                             -- normalized question, null for the opening list
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_result_clicks_created ON result_clicks(created_at);

-- Chat questions that found posts (zero-result ones stay in search_misses).
CREATE TABLE IF NOT EXISTS search_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,                    -- normalized, <= 200 chars
  mode TEXT NOT NULL,                     -- search | category | recent | answer
  post_ids TEXT NOT NULL,                 -- JSON array of the posts shown first
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_queries_created ON search_queries(created_at);
