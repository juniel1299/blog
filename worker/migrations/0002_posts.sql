-- Phase 1: indexed blog posts, their chunks (one Vectorize vector per chunk), keyword index, curated doc links.

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,               -- Tistory entry id (https://<blog>/<id>)
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT,
  tags TEXT NOT NULL DEFAULT '[]',      -- JSON array of strings
  summary TEXT,
  published_at TEXT,                    -- ISO 8601 from the post's JSON-LD
  source_lastmod TEXT NOT NULL,         -- sitemap <lastmod>; re-index when it changes
  status TEXT NOT NULL CHECK (status IN ('indexed', 'skipped')),  -- skipped: protected/empty post
  chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_chunks (
  id TEXT PRIMARY KEY,                  -- "<postId>-<position>", also the Vectorize vector id
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_chunks_post ON post_chunks(post_id);

-- trigram tokenizer so Korean substrings ("인덱스" in "인덱스란") match.
CREATE VIRTUAL TABLE IF NOT EXISTS post_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  post_id UNINDEXED,
  title,
  heading,
  text,
  tokenize = 'trigram'
);

CREATE TABLE IF NOT EXISTS doc_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technology TEXT NOT NULL,             -- e.g. 'react'
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  description TEXT,
  keywords TEXT NOT NULL DEFAULT '[]'   -- JSON array matched against post tags/category/title
);
CREATE INDEX IF NOT EXISTS idx_doc_links_technology ON doc_links(technology);

UPDATE app_meta SET value = '1' WHERE key = 'phase';
