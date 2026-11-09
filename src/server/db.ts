import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';
import { ensureDataDirs } from './config.js';
import { SCHEMA_SQL } from './schema.js';

export function openDatabase(config: AppConfig): DatabaseSync {
  ensureDataDirs(config);
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  return db;
}
