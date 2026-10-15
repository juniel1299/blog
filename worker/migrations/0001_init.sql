-- Phase 0: only app metadata. Post and doc-link tables arrive with ingestion (see docs/data-model.md).
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('phase', '0');
