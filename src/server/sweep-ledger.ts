import type { DatabaseSync } from 'node:sqlite';
import type {
  BookSweepState,
  SweepOutcome,
} from '../shared/contract.js';
import { csvLine } from './csv.js';

export interface RecordSweepInput {
  joinId: string;
  attemptedAt: string;
  outcome: SweepOutcome;
  reason?: string | null;
}

export interface SweepAuditRow {
  joinId: string;
  title: string;
  author: string | null;
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

interface AuditRow {
  join_id: string;
  title: string;
  author: string | null;
  last_attempt_at: string | null;
  outcome: SweepOutcome | null;
  reason: string | null;
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
      outcome = CASE
        WHEN excluded.outcome = 'skipped'
          AND book_sweep_ledger.outcome = 'refreshed'
          THEN book_sweep_ledger.outcome
        ELSE excluded.outcome
      END,
      reason = CASE
        WHEN excluded.outcome = 'skipped'
          AND book_sweep_ledger.outcome = 'refreshed'
          THEN book_sweep_ledger.reason
        ELSE excluded.reason
      END,
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
  if (!row) return null;

  return {
    lastAttemptAt: row.last_attempt_at,
    outcome: row.outcome,
    reason: row.reason,
    lastSuccessAt: row.last_success_at,
  };
}

export function listBooksWithoutSuccessfulSweep(
  db: DatabaseSync,
): SweepAuditRow[] {
  const rows = db
    .prepare(`
      SELECT
        b.join_id,
        b.title,
        b.author,
        l.last_attempt_at,
        l.outcome,
        l.reason
      FROM book_records b
      LEFT JOIN book_sweep_ledger l ON l.join_id = b.join_id
      WHERE b.hidden = 0
        AND l.last_success_at IS NULL
      ORDER BY b.title COLLATE NOCASE, b.join_id
    `)
    .all() as unknown as AuditRow[];

  return rows.map((row) => ({
    joinId: row.join_id,
    title: row.title,
    author: row.author,
    lastAttemptAt: row.last_attempt_at,
    outcome: row.outcome,
    reason: row.reason,
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
      'last_attempt_at',
      'outcome',
      'reason',
    ]),
    ...books.map((book) =>
      csvLine([
        book.joinId,
        book.title,
        book.author ?? '',
        book.lastAttemptAt ?? '',
        book.outcome ?? '',
        book.reason ?? '',
      ]),
    ),
  ];

  return { csv: `${lines.join('\n')}\n`, count };
}
