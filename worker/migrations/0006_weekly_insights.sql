-- Weekly insight (phase 3-3): numbers for the past 7 days plus an AI summary, made by the Monday cron
-- (or POST /admin/weekly). Aggregates only, no visitor data, kept as history; 3-4 sends it to Notion.
CREATE TABLE IF NOT EXISTS weekly_insights (
  week TEXT PRIMARY KEY,                  -- Monday of the week in Korean time, "YYYY-MM-DD"
  summary TEXT,                           -- AI summary in Korean; null when the model was unavailable
  report TEXT NOT NULL,                   -- JSON: summary numbers, top/rising posts, sources, keywords, questions, gaps
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
