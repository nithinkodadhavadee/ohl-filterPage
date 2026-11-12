import type { DatabaseSync } from 'node:sqlite';
import type {
  BookSweepState,
  SweepOutcome,
} from '../shared/contract.js';
import { csvLine } from './csv.js';
import { VISIBLE_BOOK_SQL } from './visibility.js';

export interface RecordSweepInput {
  joinId: string;
  attemptedAt: string;
  outcome: SweepOutcome;
  reason?: string | null;
}

// The sweep audit is a cumulative worklist of visible books that have no
// successful sweep yet, ordered by title. The ledger stores the latest attempt
// per book, so rows describe that attempt rather than a history of cycles;
// per-cycle history lives in the run log.
export interface SweepAuditRow {
  joinId: string;
  title: string;
  author: string | null;
  attempted: boolean;
  lastAttemptAt: string | null;
  outcome: SweepOutcome | null;
  reason: string | null;
}

export interface SweepAuditExport {
  books: SweepAuditRow[];
  count: number;
}

export interface SweepAuditCsv {
  csv: string;
  count: number;
}

interface SweepLedgerRow {
  last_attempt_at: string;
  outcome: SweepOutcome;
  reason: string | null;
  last_success_at: string | null;
}

export function recordSweepAttempt(
  db: DatabaseSync,
  input: RecordSweepInput,
): void {
  db.prepare(`
    INSERT INTO book_sweep_ledger (
      join_id, last_attempt_at, outcome, reason, last_success_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(join_id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at,
      outcome = excluded.outcome,
      reason = excluded.reason,
      last_success_at = COALESCE(
        excluded.last_success_at,
        book_sweep_ledger.last_success_at
      )
  `).run(
    input.joinId,
    input.attemptedAt,
    input.outcome,
    input.reason ?? null,
    input.outcome === 'refreshed' ? input.attemptedAt : null,
  );
}

function toSweepState(row: SweepLedgerRow): BookSweepState {
  return {
    lastAttemptAt: row.last_attempt_at,
    outcome: row.outcome,
    reason: row.reason,
    lastSuccessAt: row.last_success_at,
  };
}

export function getSweepLedger(
  db: DatabaseSync,
  joinId: string,
): BookSweepState | null {
  const row = db
    .prepare(`
      SELECT last_attempt_at, outcome, reason, last_success_at
      FROM book_sweep_ledger
      WHERE join_id = ?
    `)
    .get(joinId) as unknown as SweepLedgerRow | undefined;
  return row ? toSweepState(row) : null;
}

export function getSweepLedgers(
  db: DatabaseSync,
  joinIds: readonly string[],
): Map<string, BookSweepState> {
  const map = new Map<string, BookSweepState>();
  if (joinIds.length === 0) return map;

  const placeholders = joinIds.map(() => '?').join(', ');
  const rows = db
    .prepare(`
      SELECT join_id, last_attempt_at, outcome, reason, last_success_at
      FROM book_sweep_ledger
      WHERE join_id IN (${placeholders})
    `)
    .all(...joinIds) as unknown as Array<SweepLedgerRow & { join_id: string }>;

  for (const row of rows) {
    map.set(row.join_id, toSweepState(row));
  }
  return map;
}

interface SweepAuditQueryRow {
  joinId: string;
  title: string;
  author: string | null;
  lastAttemptAt: string | null;
  outcome: SweepOutcome | null;
  reason: string | null;
}

export function listBooksWithoutSuccessfulSweep(
  db: DatabaseSync,
): SweepAuditRow[] {
  const rows = db
    .prepare(`
      SELECT
        b.join_id AS joinId,
        b.title AS title,
        b.author AS author,
        l.last_attempt_at AS lastAttemptAt,
        l.outcome AS outcome,
        l.reason AS reason
      FROM book_records b
      LEFT JOIN book_sweep_ledger l ON l.join_id = b.join_id
      WHERE b.${VISIBLE_BOOK_SQL}
        AND l.last_success_at IS NULL
      ORDER BY b.title COLLATE NOCASE, b.join_id
    `)
    .all() as unknown as SweepAuditQueryRow[];

  return rows.map((row) => ({
    ...row,
    attempted: row.lastAttemptAt !== null,
  }));
}

export function getSweepAudit(db: DatabaseSync): SweepAuditExport {
  const books = listBooksWithoutSuccessfulSweep(db);
  return { books, count: books.length };
}

export function getSweepAuditCsv(db: DatabaseSync): SweepAuditCsv {
  const { books, count } = getSweepAudit(db);
  const lines = [
    csvLine([
      'join_id',
      'title',
      'author',
      'attempted',
      'last_attempt_at',
      'outcome',
      'reason',
    ]),
    ...books.map((book) =>
      csvLine([
        book.joinId,
        book.title,
        book.author ?? '',
        book.attempted ? 'yes' : 'no',
        book.lastAttemptAt ?? '',
        book.outcome ?? '',
        book.reason ?? '',
      ]),
    ),
  ];

  return { csv: `${lines.join('\n')}\n`, count };
}
