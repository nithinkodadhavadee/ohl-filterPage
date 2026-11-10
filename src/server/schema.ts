export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS book_records (
  join_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  year INTEGER,
  description TEXT,
  cover_path TEXT,
  copies INTEGER NOT NULL DEFAULT 0,
  out INTEGER NOT NULL DEFAULT 0,
  holds INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_refreshed_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS book_tags (
  join_id TEXT NOT NULL REFERENCES book_records(join_id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (join_id, tag)
);

CREATE TABLE IF NOT EXISTS book_subjects (
  join_id TEXT NOT NULL REFERENCES book_records(join_id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  PRIMARY KEY (join_id, subject)
);

CREATE TABLE IF NOT EXISTS enrichment (
  join_id TEXT PRIMARY KEY REFERENCES book_records(join_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT,
  matched_title TEXT,
  matched_author TEXT,
  rating_average REAL,
  rating_count INTEGER,
  page_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  enriched_at TEXT
);

CREATE TABLE IF NOT EXISTS match_overrides (
  join_id TEXT PRIMARY KEY REFERENCES book_records(join_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration INTEGER,
  counts TEXT,
  error TEXT,
  note TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  join_id UNINDEXED,
  title,
  author,
  description,
  tokenize='trigram'
);

CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags(tag);
CREATE INDEX IF NOT EXISTS idx_book_subjects_subject ON book_subjects(subject);
CREATE INDEX IF NOT EXISTS idx_run_log_kind_started_at
  ON run_log(kind, started_at DESC, id DESC);
`;
