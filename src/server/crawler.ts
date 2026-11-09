import type { DatabaseSync } from 'node:sqlite';
import { getLastIndexRefreshedAt } from './books.js';
import { getSampleJoinIds, persistBookDetail } from './circulation.js';
import {
  DEFAULT_CRAWLER_CYCLE_DELAY_MS,
  DEFAULT_CRAWLER_MAX_BACKOFF_MS,
} from './config.js';
import type { LibibDetail } from './libib-detail.js';
import { LibibRequestError } from './libib-index.js';
import {
  backoffDelayForAttempt,
  decideNextDelay,
  type CrawlOutcome,
  type ScheduleOptions,
} from './crawler-schedule.js';

export type CrawlStepOutcome = 'idle' | CrawlOutcome;

export interface CrawlerState {
  cursor: number;
  cycleStartedAt: string | null;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  backoffAttempt: number;
  lastOutcome: CrawlOutcome | null;
  lastError: string | null;
}

export interface CrawlerStatus {
  enabled: boolean;
  lastIndexRefreshedAt: string | null;
  cycle: {
    position: number;
    total: number;
    startedAt: string | null;
  };
  lastCycle: {
    startedAt: string | null;
    finishedAt: string | null;
  };
  backoff: {
    attempt: number;
    active: boolean;
  };
  lastOutcome: CrawlOutcome | null;
  lastError: string | null;
}

export interface CrawlStepDeps {
  db: DatabaseSync;
  fetchDetail: (joinId: string) => Promise<LibibDetail | null>;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  if (cursor >= total || cursor < 0) {
    cursor = 0;
    cycleStartedAt = nowIso;
    writeValue(deps.db, CURSOR_KEY, String(cursor));
    writeValue(deps.db, CYCLE_STARTED_KEY, cycleStartedAt);
  } else if (cycleStartedAt === null) {
    cycleStartedAt = nowIso;
    writeValue(deps.db, CYCLE_STARTED_KEY, cycleStartedAt);
  }

  const joinId = sampleIds[cursor];

  try {
    const detail = await deps.fetchDetail(joinId);
    if (detail) {
      persistBookDetail(deps.db, detail, nowIso);
    }

    cursor += 1;
    const cycleFinished = cursor >= total;

    if (cycleFinished) {
      writeValue(deps.db, CURSOR_KEY, String(total));
      writeValue(deps.db, LAST_CYCLE_STARTED_KEY, cycleStartedAt);
      writeValue(deps.db, LAST_CYCLE_FINISHED_KEY, nowIso);
      writeValue(deps.db, CYCLE_STARTED_KEY, null);
    } else {
      writeValue(deps.db, CURSOR_KEY, String(cursor));
    }

    writeValue(deps.db, LAST_OUTCOME_KEY, 'ok');
    writeValue(deps.db, LAST_ERROR_KEY, null);

    return {
      outcome: 'ok',
      joinId,
      position: cycleFinished ? total : cursor,
      total,
      error: null,
      cycleFinished,
    };
  } catch (error) {
    const outcome = classifyError(error);
    const message = errorMessage(error);

    writeValue(deps.db, LAST_OUTCOME_KEY, outcome);
    writeValue(deps.db, LAST_ERROR_KEY, message);

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

export function getCrawlerStatus(
  db: DatabaseSync,
  options: { enabled?: boolean } = {},
): CrawlerStatus {
  const sampleIds = getSampleJoinIds(db);
  const total = sampleIds?.length ?? 0;
  const state = readCrawlerState(db);
  const position = total === 0 ? 0 : Math.min(state.cursor, total);

  return {
    enabled: options.enabled ?? false,
    lastIndexRefreshedAt: getLastIndexRefreshedAt(db),
    cycle: {
      position,
      total,
      startedAt: state.cycleStartedAt,
    },
    lastCycle: {
      startedAt: state.lastCycleStartedAt,
      finishedAt: state.lastCycleFinishedAt,
    },
    backoff: {
      attempt: state.backoffAttempt,
      active: state.backoffAttempt > 0,
    },
    lastOutcome: state.lastOutcome,
    lastError: state.lastError,
  };
}

function defaultSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
