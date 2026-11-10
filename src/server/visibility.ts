import type { DatabaseSync } from 'node:sqlite';

export const VISIBLE_BOOK_SQL = 'hidden = 0';
export const HIDDEN_BOOK_SQL = 'hidden = 1';

export function isVisibleBook(db: DatabaseSync, joinId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found FROM book_records WHERE join_id = ? AND ${VISIBLE_BOOK_SQL}`,
    )
    .get(joinId);
  return row !== undefined;
}

export function isHiddenBook(db: DatabaseSync, joinId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS found FROM book_records WHERE join_id = ? AND ${HIDDEN_BOOK_SQL}`,
    )
    .get(joinId);
  return row !== undefined;
}

export function visibleBookIds(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT join_id FROM book_records WHERE ${VISIBLE_BOOK_SQL} ORDER BY join_id`,
      )
      .all() as unknown as { join_id: string }[]
  ).map((entry) => entry.join_id);
}
