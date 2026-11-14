-- Phase 5-2: AI 3-line summary per post (JSON array of strings), written when the post is (re)indexed.
ALTER TABLE posts ADD COLUMN ai_summary TEXT;
