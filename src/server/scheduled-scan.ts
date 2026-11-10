import { backoffDelayForAttempt } from './crawler-schedule.js';
import type { StartupTaskContext } from './startup.js';

export const DEFAULT_SCHEDULED_SCAN_MAX_ATTEMPTS = 3;
export const DEFAULT_SCHEDULED_SCAN_RETRY_BASE_MS = 60_000;
export const DEFAULT_SCHEDULED_SCAN_RETRY_MAX_MS = 900_000;

export interface ScheduledScanStatus {
  enabled: boolean;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
}

export type ScheduledSleep = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;

export interface ScheduledScanRunResult {
  ok: boolean;
  attempts: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface ScheduledScanDeps {
  scan: () => Promise<unknown>;
  enrich: (context: StartupTaskContext) => Promise<unknown>;
  intervalMs: number;
  now?: () => Date;
  sleep?: ScheduledSleep;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  jitterRatio?: number;
  random?: () => number;
  logger?: (message: string) => void;
  onEnrichmentComplete?: (at: Date) => void;
}

export interface ScheduledScanHandle {
  status: () => ScheduledScanStatus;
  done: Promise<void>;
  stop: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function normalizeAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_SCHEDULED_SCAN_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.floor(value));
}

export async function runScheduledScanOnce(
  deps: ScheduledScanDeps,
  signal?: AbortSignal,
): Promise<ScheduledScanRunResult> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = normalizeAttempts(deps.maxAttempts);
  const runSignal = signal ?? new AbortController().signal;
  const startedAt = now().toISOString();
  let attempt = 0;
  let error: string | null = null;

  while (attempt < maxAttempts) {
    if (runSignal.aborted) break;
    attempt += 1;

    try {
      await deps.scan();
      await deps.enrich({ signal: runSignal });
      const finishedAt = now();
      deps.onEnrichmentComplete?.(finishedAt);

      return {
        ok: true,
        attempts: attempt,
        error: null,
        startedAt,
        finishedAt: finishedAt.toISOString(),
      };
    } catch (caught) {
      error = errorMessage(caught);
      deps.logger?.(
        `Scheduled catalogue scan attempt ${attempt} failed: ${error}`,
      );

      if (attempt >= maxAttempts || runSignal.aborted) break;

      const delayMs = backoffDelayForAttempt(attempt, {
        baseDelayMs:
          deps.retryBaseMs ?? DEFAULT_SCHEDULED_SCAN_RETRY_BASE_MS,
        maxDelayMs: deps.retryMaxMs ?? DEFAULT_SCHEDULED_SCAN_RETRY_MAX_MS,
        jitterRatio: deps.jitterRatio,
        random: deps.random,
      });
      await sleep(delayMs, runSignal);
    }
  }

  return {
    ok: false,
    attempts: attempt,
    error,
    startedAt,
    finishedAt: now().toISOString(),
  };
}

export function startScheduledScan(
  deps: ScheduledScanDeps,
): ScheduledScanHandle {
  const logger =
    deps.logger ??
    ((message: string) => {
      console.error(message);
    });
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const intervalMs = deps.intervalMs;
  const enabled = Number.isFinite(intervalMs) && intervalMs > 0;
  const controller = new AbortController();

  const status: ScheduledScanStatus = {
    enabled,
    intervalMs,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
  };

  if (!enabled) {
    return {
      status: () => status,
      done: Promise.resolve(),
      stop: async () => {},
    };
  }

  let nextAt = now().getTime() + intervalMs;
  status.nextRunAt = new Date(nextAt).toISOString();

  const done = (async () => {
    while (!controller.signal.aborted) {
      const waitMs = Math.max(0, nextAt - now().getTime());
      if (waitMs > 0) await sleep(waitMs, controller.signal);
      if (controller.signal.aborted) break;

      status.lastRunAt = now().toISOString();

      try {
        const result = await runScheduledScanOnce(deps, controller.signal);
        status.lastError = result.error;
        if (!result.ok) {
          logger(
            `Scheduled catalogue scan failed after ${result.attempts} attempt(s): ` +
              `${result.error ?? 'unknown error'}`,
          );
        }
      } catch (caught) {
        status.lastError = errorMessage(caught);
        logger(`Scheduled catalogue scan failed: ${status.lastError}`);
      }

      if (controller.signal.aborted) break;

      const current = now().getTime();
      do {
        nextAt += intervalMs;
      } while (nextAt <= current);
      status.nextRunAt = new Date(nextAt).toISOString();
    }
  })();

  return {
    status: () => status,
    done,
    async stop() {
      controller.abort();
      await done;
    },
  };
}
