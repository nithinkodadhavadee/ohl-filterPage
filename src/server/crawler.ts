import type { DatabaseSync } from 'node:sqlite';
import { getLastIndexRefreshedAt } from './books.js';
import { getSampleJoinIds, persistBookDetail } from './circulation.js';
import {
  DEFAULT_CRAWLER_CYCLE_DELAY_MS,
  DEFAULT_CRAWLER_MAX_BACKOFF_MS,
} from './config.js';
import {
  enrichOnFirstSight,
  type EnrichmentAdapterRegistry,
} from './enrichment.js';
import type { LibibDetail } from './libib-detail.js';
import {
  finishRun,
  findLatestRun,
  readRuns,
  startRun,
  updateRun,
  type RunCounts,
} from './run-log.js';
import { recordSweepAttempt } from './sweep-ledger.js';
import { errorMessage, sleep as defaultSleep } from './util.js';
import { LibibRequestError } from './libib-index.js';
import {
  backoffDelayForAttempt,
  decideNextDelay,
  type CrawlOutcome,
  type ScheduleOptions,
} from './crawler-schedule.js';
import type { ScheduledScanStatus } from './scheduled-scan.js';
import type { StartupStatus } from './startup.js';

export type CrawlStepOutcome = 'idle' | CrawlOutcome;

export interface CrawlerState {
  cursor: number;
  cycleStartedAt: string | null;
  lastProgressAt: string | null;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  backoffAttempt: number;
  lastOutcome: CrawlOutcome | null;
  lastError: string | null;
}

export const DEFAULT_SWEEP_STALL_THRESHOLD_MS = 5 * 60 * 1000;

export interface CrawlerStatus {
  enabled: boolean;
  lastIndexRefreshedAt: string | null;
  cycle: {
    position: number;
    total: number;
    startedAt: string | null;
    estimatedRemainingMs: number | null;
    stalled: boolean;
  };
  lastCycle: {
    startedAt: string | null;
    finishedAt: string | null;
    duration: number | null;
    counts: RunCounts | null;
    lastError: string | null;
  };
  backoff: {
    attempt: number;
    active: boolean;
  };
  lastOutcome: CrawlOutcome | null;
  lastError: string | null;
  startup?: StartupStatus;
  scheduled?: ScheduledScanStatus;
}

export interface CrawlStepDeps {
  db: DatabaseSync;
  fetchDetail: (joinId: string) => Promise<LibibDetail | null>;
  adapters?: EnrichmentAdapterRegistry;
  now?: () => Date;
}

export interface CrawlStepResult {
  outcome: CrawlStepOutcome;
  joinId: string | null;
  position: number;
  total: number;
  error: string | null;
  cycleFinished: boolean;
}

export type CrawlSleep = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;

export interface CrawlerLoopDeps extends CrawlStepDeps {
  cycleDelayMs?: number;
  maxBackoffMs?: number;
  jitterRatio?: number;
  random?: () => number;
  sleep?: CrawlSleep;
  logger?: (message: string) => void;
}

export interface StartCrawlerOptions extends CrawlerLoopDeps {
  enabled?: boolean;
}

export interface CrawlerHandle {
  stop: () => void;
  done: Promise<void>;
}

const CURSOR_KEY = 'crawl_cursor';
const CYCLE_STARTED_KEY = 'crawl_cycle_started_at';
const LAST_CYCLE_STARTED_KEY = 'crawl_last_cycle_started_at';
const LAST_CYCLE_FINISHED_KEY = 'crawl_last_cycle_finished_at';
const BACKOFF_ATTEMPT_KEY = 'crawl_backoff_attempt';
const LAST_OUTCOME_KEY = 'crawl_last_outcome';
const LAST_ERROR_KEY = 'crawl_last_error';
const LAST_PROGRESS_KEY = 'crawl_last_progress_at';
const CYCLE_RUN_ID_KEY = 'crawl_cycle_run_id';
const CYCLE_REFRESHED_KEY = 'crawl_cycle_refreshed';
const CYCLE_SKIPPED_KEY = 'crawl_cycle_skipped';
const CYCLE_FAILED_KEY = 'crawl_cycle_failed';
const CYCLE_LAST_ERROR_KEY = 'crawl_cycle_last_error';

function readValue(db: DatabaseSync, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM crawl_state WHERE key = ?')
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function writeValue(
  db: DatabaseSync,
  key: string,
  value: string | null,
): void {
  db.prepare(
    `INSERT INTO crawl_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function parseNonNegativeInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOutcome(value: string | null): CrawlOutcome | null {
  return value === 'ok' || value === 'throttled' || value === 'error'
    ? value
    : null;
}

export function readCrawlerState(db: DatabaseSync): CrawlerState {
  return {
    cursor: parseNonNegativeInteger(readValue(db, CURSOR_KEY), 0),
    cycleStartedAt: readValue(db, CYCLE_STARTED_KEY),
    lastProgressAt: readValue(db, LAST_PROGRESS_KEY),
    lastCycleStartedAt: readValue(db, LAST_CYCLE_STARTED_KEY),
    lastCycleFinishedAt: readValue(db, LAST_CYCLE_FINISHED_KEY),
    backoffAttempt: parseNonNegativeInteger(
      readValue(db, BACKOFF_ATTEMPT_KEY),
      0,
    ),
    lastOutcome: parseOutcome(readValue(db, LAST_OUTCOME_KEY)),
    lastError: readValue(db, LAST_ERROR_KEY),
  };
}

function classifyError(error: unknown): CrawlOutcome {
  if (
    error instanceof LibibRequestError &&
    (error.status === 403 || error.status === 429)
  ) {
    return 'throttled';
  }
  return 'error';
}

function needsFirstSightEnrichment(
  db: DatabaseSync,
  joinId: string,
): boolean {
  const row = db
    .prepare('SELECT last_refreshed_at FROM book_records WHERE join_id = ?')
    .get(joinId) as { last_refreshed_at: string | null } | undefined;
  return row !== undefined && row.last_refreshed_at === null;
}

function readCounter(db: DatabaseSync, key: string): number {
  return parseNonNegativeInteger(readValue(db, key), 0);
}

function cycleCounts(
  position: number,
  total: number,
  refreshed: number,
  skipped: number,
  failed: number,
): RunCounts {
  return { position, total, refreshed, skipped, failed };
}

function startSweepCycle(
  db: DatabaseSync,
  startedAt: string,
  resetCursor: boolean,
): number {
  if (resetCursor) writeValue(db, CURSOR_KEY, '0');
  writeValue(db, CYCLE_STARTED_KEY, startedAt);
  writeValue(db, LAST_PROGRESS_KEY, startedAt);
  writeValue(db, CYCLE_REFRESHED_KEY, '0');
  writeValue(db, CYCLE_SKIPPED_KEY, '0');
  writeValue(db, CYCLE_FAILED_KEY, '0');
  writeValue(db, CYCLE_LAST_ERROR_KEY, null);

  const runId = startRun(db, {
    kind: 'book_sweep_cycle',
    trigger: 'automatic',
    note: 'cycle',
    startedAt,
  });
  writeValue(db, CYCLE_RUN_ID_KEY, String(runId));
  return runId;
}

function ensureSweepCycleRun(
  db: DatabaseSync,
  startedAt: string,
): number {
  const existing = parseNonNegativeInteger(
    readValue(db, CYCLE_RUN_ID_KEY),
    0,
  );
  if (existing > 0) {
    if (readValue(db, LAST_PROGRESS_KEY) === null) {
      writeValue(db, LAST_PROGRESS_KEY, startedAt);
    }
    return existing;
  }

  const runId = startRun(db, {
    kind: 'book_sweep_cycle',
    trigger: 'automatic',
    note: 'cycle',
    startedAt,
  });
  writeValue(db, CYCLE_RUN_ID_KEY, String(runId));
  if (readValue(db, LAST_PROGRESS_KEY) === null) {
    writeValue(db, LAST_PROGRESS_KEY, startedAt);
  }
  return runId;
}

export async function crawlOne(deps: CrawlStepDeps): Promise<CrawlStepResult> {
  const sampleIds = getSampleJoinIds(deps.db);
  const total = sampleIds?.length ?? 0;
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const state = readCrawlerState(deps.db);

  if (total === 0 || sampleIds === null) {
    return {
      outcome: 'idle',
      joinId: null,
      position: 0,
      total: 0,
      error: null,
      cycleFinished: false,
    };
  }

  let cursor = state.cursor;
  let cycleStartedAt = state.cycleStartedAt;
  let runId: number;

  if (cursor >= total || cursor < 0) {
    cursor = 0;
    cycleStartedAt = nowIso;
    runId = startSweepCycle(deps.db, nowIso, true);
  } else if (cycleStartedAt === null) {
    cycleStartedAt = nowIso;
    runId = startSweepCycle(deps.db, nowIso, false);
  } else {
    runId = ensureSweepCycleRun(deps.db, cycleStartedAt);
  }

  const startedAt = cycleStartedAt;
  const joinId = sampleIds[cursor];

  try {
    if (
      deps.adapters &&
      deps.adapters.size > 0 &&
      needsFirstSightEnrichment(deps.db, joinId)
    ) {
      try {
        await enrichOnFirstSight(deps.db, deps.adapters, joinId, {
          now: deps.now,
        });
      } catch {
        // A first-sight enrichment failure must not block the detail refresh.
      }
    }

    const detail = await deps.fetchDetail(joinId);
    let refreshed = readCounter(deps.db, CYCLE_REFRESHED_KEY);
    let skipped = readCounter(deps.db, CYCLE_SKIPPED_KEY);
    const failed = readCounter(deps.db, CYCLE_FAILED_KEY);

    if (detail) {
      persistBookDetail(deps.db, detail, nowIso);
      recordSweepAttempt(deps.db, {
        joinId,
        attemptedAt: nowIso,
        outcome: 'refreshed',
      });
      refreshed += 1;
    } else {
      recordSweepAttempt(deps.db, {
        joinId,
        attemptedAt: nowIso,
        outcome: 'skipped',
        reason: 'Libib returned no detail',
      });
      skipped += 1;
    }

    cursor += 1;
    const cycleFinished = cursor >= total;
    const position = cycleFinished ? total : cursor;
    const counts = cycleCounts(
      position,
      total,
      refreshed,
      skipped,
      failed,
    );

    writeValue(deps.db, CYCLE_REFRESHED_KEY, String(refreshed));
    writeValue(deps.db, CYCLE_SKIPPED_KEY, String(skipped));
    writeValue(deps.db, CURSOR_KEY, String(position));
    writeValue(deps.db, LAST_PROGRESS_KEY, nowIso);

    if (cycleFinished) {
      writeValue(deps.db, LAST_CYCLE_STARTED_KEY, startedAt);
      writeValue(deps.db, LAST_CYCLE_FINISHED_KEY, nowIso);
      writeValue(deps.db, CYCLE_STARTED_KEY, null);
      writeValue(deps.db, CYCLE_RUN_ID_KEY, null);
      finishRun(deps.db, runId, {
        status: failed > 0 ? 'partial' : 'ok',
        counts,
        error:
          failed > 0 ? readValue(deps.db, CYCLE_LAST_ERROR_KEY) : null,
        finishedAt: nowIso,
      });
    } else {
      updateRun(deps.db, runId, { counts });
    }

    writeValue(deps.db, LAST_OUTCOME_KEY, 'ok');
    writeValue(deps.db, LAST_ERROR_KEY, null);

    return {
      outcome: 'ok',
      joinId,
      position,
      total,
      error: null,
      cycleFinished,
    };
  } catch (error) {
    const outcome = classifyError(error);
    const message = errorMessage(error);
    const failed = readCounter(deps.db, CYCLE_FAILED_KEY) + 1;

    recordSweepAttempt(deps.db, {
      joinId,
      attemptedAt: nowIso,
      outcome: 'failed',
      reason: message,
    });

    writeValue(deps.db, CYCLE_FAILED_KEY, String(failed));
    writeValue(deps.db, LAST_OUTCOME_KEY, outcome);
    writeValue(deps.db, LAST_ERROR_KEY, message);
    writeValue(deps.db, CYCLE_LAST_ERROR_KEY, message);

    updateRun(deps.db, runId, {
      counts: cycleCounts(
        Math.min(cursor, total),
        total,
        readCounter(deps.db, CYCLE_REFRESHED_KEY),
        readCounter(deps.db, CYCLE_SKIPPED_KEY),
        failed,
      ),
      error: message,
    });

    return {
      outcome,
      joinId,
      position: Math.min(cursor, total),
      total,
      error: message,
      cycleFinished: false,
    };
  }
}

const RECENT_SWEEP_RUNS = 5;

function recentPaceMsPerBook(db: DatabaseSync): number | null {
  const runs = readRuns(db, 'book_sweep_cycle', {
    limit: RECENT_SWEEP_RUNS,
    statuses: ['ok', 'partial'],
  });

  const rates: number[] = [];
  for (const run of runs) {
    const completed = run.counts?.position ?? 0;
    if (run.duration !== null && completed > 0) {
      rates.push(run.duration / completed);
    }
  }
  if (rates.length === 0) return null;

  return rates.reduce((total, rate) => total + rate, 0) / rates.length;
}

function estimateRemainingMs(
  db: DatabaseSync,
  position: number,
  total: number,
  cycleStartedAt: string | null,
  nowMs: number,
): number | null {
  if (total <= 0) return null;
  if (position >= total) return 0;

  let pace = recentPaceMsPerBook(db);
  if (pace === null && cycleStartedAt !== null && position > 0) {
    const startedMs = Date.parse(cycleStartedAt);
    if (Number.isFinite(startedMs) && nowMs > startedMs) {
      pace = (nowMs - startedMs) / position;
    }
  }

  if (pace === null || !Number.isFinite(pace) || pace < 0) return null;
  return Math.round((total - position) * pace);
}

function isSweepStalled(
  state: CrawlerState,
  position: number,
  total: number,
  nowMs: number,
  thresholdMs: number,
): boolean {
  if (state.cycleStartedAt === null || total === 0 || position >= total) {
    return false;
  }

  const marker = state.lastProgressAt ?? state.cycleStartedAt;
  const markerMs = Date.parse(marker);
  if (!Number.isFinite(markerMs)) return false;
  return nowMs - markerMs > thresholdMs;
}

function durationBetween(
  startedAt: string | null,
  finishedAt: string | null,
): number | null {
  if (startedAt === null || finishedAt === null) return null;
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return null;
  return Math.max(0, finished - started);
}

export function getCrawlerStatus(
  db: DatabaseSync,
  options: {
    enabled?: boolean;
    startup?: StartupStatus;
    scheduled?: ScheduledScanStatus;
    now?: () => Date;
    stallThresholdMs?: number;
  } = {},
): CrawlerStatus {
  const sampleIds = getSampleJoinIds(db);
  const total = sampleIds?.length ?? 0;
  const state = readCrawlerState(db);
  const position = total === 0 ? 0 : Math.min(state.cursor, total);
  const now = options.now?.() ?? new Date();
  const nowMs = now.getTime();
  const stallThresholdMs =
    options.stallThresholdMs ?? DEFAULT_SWEEP_STALL_THRESHOLD_MS;
  const lastRun = findLatestRun(db, 'book_sweep_cycle', [
    'ok',
    'partial',
    'failed',
  ]);

  const status: CrawlerStatus = {
    enabled: options.enabled ?? false,
    lastIndexRefreshedAt: getLastIndexRefreshedAt(db),
    cycle: {
      position,
      total,
      startedAt: state.cycleStartedAt,
      estimatedRemainingMs: estimateRemainingMs(
        db,
        position,
        total,
        state.cycleStartedAt,
        nowMs,
      ),
      stalled: isSweepStalled(state, position, total, nowMs, stallThresholdMs),
    },
    lastCycle: lastRun
      ? {
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
          duration: lastRun.duration,
          counts: lastRun.counts,
          lastError: lastRun.error,
        }
      : {
          startedAt: state.lastCycleStartedAt,
          finishedAt: state.lastCycleFinishedAt,
          duration: durationBetween(
            state.lastCycleStartedAt,
            state.lastCycleFinishedAt,
          ),
          counts: null,
          lastError: null,
        },
    backoff: {
      attempt: state.backoffAttempt,
      active: state.backoffAttempt > 0,
    },
    lastOutcome: state.lastOutcome,
    lastError: state.lastError,
  };

  if (options.startup) status.startup = options.startup;
  if (options.scheduled) status.scheduled = options.scheduled;
  return status;
}

function scheduleOptions(deps: CrawlerLoopDeps): ScheduleOptions {
  return {
    baseDelayMs: deps.cycleDelayMs ?? DEFAULT_CRAWLER_CYCLE_DELAY_MS,
    maxDelayMs: deps.maxBackoffMs ?? DEFAULT_CRAWLER_MAX_BACKOFF_MS,
    jitterRatio: deps.jitterRatio,
    random: deps.random,
  };
}

export async function runCrawlerLoop(
  deps: CrawlerLoopDeps,
  signal?: AbortSignal,
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  const options = scheduleOptions(deps);
  let attempt = readCrawlerState(deps.db).backoffAttempt;

  if (attempt > 0) {
    await sleep(backoffDelayForAttempt(attempt, options), signal);
  }

  while (!signal?.aborted) {
    const result = await crawlOne(deps);
    const decision = decideNextDelay(
      {
        outcome: result.outcome === 'idle' ? 'ok' : result.outcome,
        attempt,
      },
      options,
    );
    attempt = decision.attempt;
    writeValue(deps.db, BACKOFF_ATTEMPT_KEY, String(attempt));

    await sleep(decision.delayMs, signal);
  }
}

export function startCrawler(options: StartCrawlerOptions): CrawlerHandle {
  const controller = new AbortController();
  const enabled = options.enabled ?? true;

  if (!enabled) {
    return {
      stop: () => controller.abort(),
      done: Promise.resolve(),
    };
  }

  const logger =
    options.logger ??
    ((message: string) => {
      console.error(message);
    });

  const done = runCrawlerLoop(options, controller.signal).catch((error) => {
    logger(`Rolling crawler stopped unexpectedly: ${errorMessage(error)}`);
  });

  return {
    stop: () => controller.abort(),
    done,
  };
}
