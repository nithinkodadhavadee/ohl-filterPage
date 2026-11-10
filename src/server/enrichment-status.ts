import type { DatabaseSync } from 'node:sqlite';
import type {
  EnrichmentStatusCounts,
  EnrichmentStatusSummary,
} from '../shared/contract.js';
import {
  DEFAULT_RUN_HISTORY_LIMIT,
  findRunningRun,
  readRuns,
} from './run-log.js';
import { readLastFullEnrichmentAt } from './startup.js';

interface CountRow {
  total: number;
  enriched: number | null;
  unmatched: number | null;
  failed: number | null;
}

interface TimeRow {
  started_at: string;
  finished_at: string | null;
}

export interface EnrichmentStatusOptions {
  nextScheduledRunAt?: string | null;
  historyLimit?: number;
}

function readCounts(db: DatabaseSync): EnrichmentStatusCounts {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN e.status IN ('enriched', 'matched') THEN 1 ELSE 0 END)
          AS enriched,
        SUM(CASE WHEN e.status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched,
        SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM book_records b
      LEFT JOIN enrichment e ON e.join_id = b.join_id
      WHERE b.hidden = 0
    `)
    .get() as unknown as CountRow | undefined;

  const total = row?.total ?? 0;
  const enriched = row?.enriched ?? 0;
  const unmatched = row?.unmatched ?? 0;
  const failed = row?.failed ?? 0;

  return {
    enriched,
    unmatched,
    failed,
    pending: Math.max(0, total - enriched - unmatched - failed),
    total,
  };
}

function readLastFullPassAt(db: DatabaseSync): string | null {
  const row = db
    .prepare(`
      SELECT started_at, finished_at FROM run_log
      WHERE kind = 'enrichment_pass'
        AND note = 'all'
        AND finished_at IS NOT NULL
      ORDER BY finished_at DESC, id DESC
      LIMIT 1
    `)
    .get() as unknown as TimeRow | undefined;

  return row?.finished_at ?? row?.started_at ?? readLastFullEnrichmentAt(db);
}

export function getEnrichmentStatus(
  db: DatabaseSync,
  options: EnrichmentStatusOptions = {},
): EnrichmentStatusSummary {
  const lastFailed = db
    .prepare(`
      SELECT error FROM run_log
      WHERE kind = 'enrichment_pass' AND error IS NOT NULL
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `)
    .get() as { error: string | null } | undefined;

  return {
    lastFullPassAt: readLastFullPassAt(db),
    inProgress: findRunningRun(db, 'enrichment_pass') !== null,
    nextScheduledRunAt: options.nextScheduledRunAt ?? null,
    lastError: lastFailed?.error ?? null,
    counts: readCounts(db),
    history: readRuns(db, 'enrichment_pass', {
      limit: options.historyLimit ?? DEFAULT_RUN_HISTORY_LIMIT,
    }),
  };
}
