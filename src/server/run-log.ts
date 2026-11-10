import type { DatabaseSync } from 'node:sqlite';
import {
  type RunCounts,
  type RunKind,
  type RunLogEntry,
  type RunStatus,
  type RunTrigger,
} from '../shared/run-log.js';
import { errorMessage } from './util.js';

export type {
  RunCounts,
  RunKind,
  RunLogEntry,
  RunStatus,
  RunTrigger,
} from '../shared/run-log.js';

interface RunLogRow {
  id: number;
  kind: RunKind;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  duration: number | null;
  counts: string | null;
  error: string | null;
  note: string | null;
}

export interface StartRunInput {
  kind: RunKind;
  trigger: RunTrigger;
  note?: string | null;
  startedAt?: Date | string;
}

export interface FinishRunInput {
  status: Exclude<RunStatus, 'running'>;
  counts?: RunCounts | null;
  error?: string | null;
  note?: string | null;
  finishedAt?: Date | string;
}

export interface RecordRunInput extends StartRunInput {
  status: RunStatus;
  counts?: RunCounts | null;
  error?: string | null;
  finishedAt?: Date | string;
}

export interface ReadRunsOptions {
  limit?: number;
  offset?: number;
  statuses?: readonly RunStatus[];
}

export const DEFAULT_RUN_HISTORY_LIMIT = 20;

function toIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function durationBetween(startedAt: string, finishedAt: string): number {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return 0;
  return Math.max(0, finished - started);
}

function parseCounts(value: string | null): RunCounts | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const counts: RunCounts = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        counts[key] = entry;
      }
    }
    return counts;
  } catch {
    return null;
  }
}

function toEntry(row: RunLogRow): RunLogEntry {
  return {
    id: row.id,
    kind: row.kind,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    duration: row.duration,
    counts: parseCounts(row.counts),
    error: row.error,
    note: row.note,
  };
}

function serializeCounts(counts: RunCounts | null | undefined): string | null {
  if (!counts) return null;
  return JSON.stringify(counts);
}

export function startRun(db: DatabaseSync, input: StartRunInput): number {
  const startedAt = toIso(input.startedAt ?? new Date());
  const result = db
    .prepare(`
      INSERT INTO run_log (kind, trigger, status, started_at, note)
      VALUES (?, ?, 'running', ?, ?)
    `)
    .run(input.kind, input.trigger, startedAt, input.note ?? null);
  return Number(result.lastInsertRowid);
}

export function finishRun(
  db: DatabaseSync,
  id: number,
  input: FinishRunInput,
): void {
  const row = db
    .prepare('SELECT started_at FROM run_log WHERE id = ?')
    .get(id) as { started_at: string } | undefined;
  if (!row) return;

  const finishedAt = toIso(input.finishedAt ?? new Date());
  db.prepare(`
    UPDATE run_log
    SET status = ?,
        finished_at = ?,
        duration = ?,
        counts = COALESCE(?, counts),
        error = ?,
        note = COALESCE(?, note)
    WHERE id = ?
  `).run(
    input.status,
    finishedAt,
    durationBetween(row.started_at, finishedAt),
    serializeCounts(input.counts),
    input.error ?? null,
    input.note ?? null,
    id,
  );
}

export function recordRun(db: DatabaseSync, input: RecordRunInput): number {
  const startedAt = toIso(input.startedAt ?? new Date());
  const finishedAt = toIso(input.finishedAt ?? input.startedAt ?? new Date());
  const result = db
    .prepare(`
      INSERT INTO run_log (
        kind, trigger, status, started_at, finished_at, duration, counts,
        error, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.kind,
      input.trigger,
      input.status,
      startedAt,
      finishedAt,
      durationBetween(startedAt, finishedAt),
      serializeCounts(input.counts),
      input.error ?? null,
      input.note ?? null,
    );
  return Number(result.lastInsertRowid);
}

export async function withRun<T>(
  db: DatabaseSync,
  start: StartRunInput,
  action: () => Promise<T> | T,
  finish: (result: T) => FinishRunInput,
): Promise<T> {
  const id = startRun(db, start);
  try {
    const result = await action();
    finishRun(db, id, finish(result));
    return result;
  } catch (error) {
    finishRun(db, id, { status: 'failed', error: errorMessage(error) });
    throw error;
  }
}

export function readRuns(
  db: DatabaseSync,
  kinds: RunKind | readonly RunKind[],
  options: ReadRunsOptions = {},
): RunLogEntry[] {
  const list: RunKind[] =
    typeof kinds === 'string' ? [kinds] : [...kinds];
  if (list.length === 0) return [];

  const limit = Math.max(1, Math.trunc(options.limit ?? DEFAULT_RUN_HISTORY_LIMIT));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const statuses = options.statuses ? [...options.statuses] : [];

  const conditions = [
    `kind IN (${list.map(() => '?').join(', ')})`,
  ];
  const params: Array<string | number> = [...list];

  if (statuses.length > 0) {
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }

  params.push(limit, offset);

  const rows = db
    .prepare(`
      SELECT * FROM run_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY started_at DESC, id DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params) as unknown as RunLogRow[];

  return rows.map(toEntry);
}

export function findLatestRun(
  db: DatabaseSync,
  kinds: RunKind | readonly RunKind[],
  statuses?: readonly RunStatus[],
): RunLogEntry | null {
  return readRuns(db, kinds, { limit: 1, statuses })[0] ?? null;
}

export function findRunningRun(
  db: DatabaseSync,
  kind: RunKind,
): RunLogEntry | null {
  return findLatestRun(db, kind, ['running']);
}
