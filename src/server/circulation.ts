import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_DETAIL_DELAY_MS, type LibibDetail } from './libib-detail.js';
import { sleep as defaultSleep } from './util.js';
import { HIDDEN_BOOK_SQL } from './visibility.js';

export interface BookSweepDeps {
  fetchDetail: (joinId: string) => Promise<LibibDetail | null>;
  now?: () => Date;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  joinIds?: readonly string[];
}

export interface BookSweepResult {
  sampleSize: number;
  refreshed: number;
  skipped: number;
}

const SAMPLE_KEY = 'sample_join_ids';

export function getSampleJoinIds(db: DatabaseSync): string[] | null {
  const statement = db.prepare('SELECT value FROM crawl_state WHERE key = ?');
  const result = statement.get(SAMPLE_KEY) as { value: string | null } | undefined;
  if (!result?.value) return null;

  try {
    const parsed: unknown = JSON.parse(result.value);
    if (!Array.isArray(parsed)) return null;
    const hidden = new Set(
      (
        db
          .prepare(
            `SELECT join_id FROM book_records WHERE ${HIDDEN_BOOK_SQL}`,
          )
          .all() as unknown as { join_id: string }[]
      ).map((entry) => entry.join_id),
    );
    return parsed.filter(
      (id): id is string => typeof id === 'string' && !hidden.has(id),
    );
  } catch {
    return null;
  }
}

export function persistBookDetail(
  db: DatabaseSync,
  detail: LibibDetail,
  refreshedAt: string,
): void {
  const upsertBook = db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, publisher, year, description, cover_path,
      copies, out, holds, first_seen_at, last_refreshed_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(join_id) DO UPDATE SET
      title = excluded.title,
      author = COALESCE(excluded.author, book_records.author),
      publisher = excluded.publisher,
      year = excluded.year,
      description = excluded.description,
      copies = excluded.copies,
      out = excluded.out,
      holds = excluded.holds,
      last_refreshed_at = excluded.last_refreshed_at
  `);
  const readBook = db.prepare(
    'SELECT title, author, description FROM book_records WHERE join_id = ?',
  );
  const deleteTags = db.prepare('DELETE FROM book_tags WHERE join_id = ?');
  const insertTag = db.prepare(
    'INSERT INTO book_tags (join_id, tag) VALUES (?, ?)',
  );
  const deleteFts = db.prepare('DELETE FROM books_fts WHERE join_id = ?');
  const insertFts = db.prepare(`
    INSERT INTO books_fts (join_id, title, author, description)
    VALUES (?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    upsertBook.run(
      detail.joinId,
      detail.title,
      detail.author,
      detail.publisher,
      detail.year,
      detail.description,
      detail.copies,
      detail.out,
      detail.holds,
      refreshedAt,
      refreshedAt,
    );

    deleteTags.run(detail.joinId);
    for (const tag of new Set(detail.tags)) {
      insertTag.run(detail.joinId, tag);
    }

    const stored = readBook.get(detail.joinId) as
      | { title: string; author: string | null; description: string | null }
      | undefined;
    if (stored) {
      deleteFts.run(detail.joinId);
      insertFts.run(
        detail.joinId,
        stored.title,
        stored.author ?? '',
        stored.description ?? '',
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function sweepBookDetails(
  db: DatabaseSync,
  deps: BookSweepDeps,
): Promise<BookSweepResult> {
  const sampleIds = deps.joinIds ?? getSampleJoinIds(db);
  if (sampleIds === null || sampleIds.length === 0) {
    return { sampleSize: 0, refreshed: 0, skipped: 0 };
  }

  const refreshedAt = (deps.now?.() ?? new Date()).toISOString();
  const delayMs = deps.delayMs ?? DEFAULT_DETAIL_DELAY_MS;
  const sleep = deps.sleep ?? defaultSleep;

  let refreshed = 0;
  let skipped = 0;

  for (let index = 0; index < sampleIds.length; index += 1) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    const detail = await deps.fetchDetail(sampleIds[index]);
    if (!detail) {
      skipped += 1;
      continue;
    }

    persistBookDetail(db, detail, refreshedAt);
    refreshed += 1;
  }

  return { sampleSize: sampleIds.length, refreshed, skipped };
}
