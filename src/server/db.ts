import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';
import { ensureDataDirs } from './config.js';
import { SCHEMA_SQL } from './schema.js';

function hasColumn(
  db: DatabaseSync,
  table: string,
  column: string,
): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as { name: string }[];
  return columns.some((entry) => entry.name === column);
}

function migrate(db: DatabaseSync): void {
  if (!hasColumn(db, 'book_records', 'hidden')) {
    db.exec(
      'ALTER TABLE book_records ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;',
    );
  }
}

export function openDatabase(config: AppConfig): DatabaseSync {
  ensureDataDirs(config);
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}
