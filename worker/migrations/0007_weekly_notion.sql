-- Phase 3-4: the Notion page each weekly insight was sent to, so rebuilding a week rewrites the same page.
ALTER TABLE weekly_insights ADD COLUMN notion_page_id TEXT;
ALTER TABLE weekly_insights ADD COLUMN notion_url TEXT;
