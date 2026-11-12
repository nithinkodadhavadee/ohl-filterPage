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

CREATE TABLE IF NOT EXISTS book_sweep_ledger (
  join_id TEXT PRIMARY KEY REFERENCES book_records(join_id) ON DELETE CASCADE,
  last_attempt_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('refreshed', 'skipped', 'failed')),
  reason TEXT,
  last_success_at TEXT
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

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  day TEXT NOT NULL,
  visitor_hash TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  device TEXT,
  browser TEXT,
  os TEXT,
  referrer_host TEXT,
  path TEXT,
  status_code INTEGER,
  query TEXT,
  filters TEXT,
  sort TEXT,
  result_count INTEGER,
  zero_results INTEGER NOT NULL DEFAULT 0,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS analytics_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_book_sweep_ledger_success
  ON book_sweep_ledger(last_success_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_time
  ON analytics_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_kind_time
  ON analytics_events(kind, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_day
  ON analytics_events(day);
`;
