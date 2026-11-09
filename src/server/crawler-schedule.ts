export type CrawlOutcome = 'ok' | 'throttled' | 'error';

export interface ScheduleState {
  outcome: CrawlOutcome;
  attempt: number;
}

export interface ScheduleOptions {
  baseDelayMs: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  maxAttempt?: number;
}

export interface ScheduleDecision {
  delayMs: number;
  attempt: number;
  backingOff: boolean;
  outcome: CrawlOutcome;
}

export const DEFAULT_JITTER_RATIO = 0.2;
const DEFAULT_MAX_ATTEMPT = 30;

function normalizeAttempt(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return 0;
  return Math.floor(attempt);
}

function clampRatio(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_JITTER_RATIO;
  }
  return Math.min(1, Math.max(0, value));
}

function delayBounds(options: ScheduleOptions): { base: number; max: number } {
  const base = Math.max(0, options.baseDelayMs);
  const max = Math.max(base, options.maxDelayMs ?? base);
  return { base, max };
}

export function backoffDelayForAttempt(
  attempt: number,
  options: ScheduleOptions,
): number {
  const { base, max } = delayBounds(options);
  const normalized = normalizeAttempt(attempt);
  if (normalized <= 0) return base;

  const maxAttempt = Math.max(1, options.maxAttempt ?? DEFAULT_MAX_ATTEMPT);
  const exponent = Math.min(normalized, maxAttempt) - 1;
  const capped = Math.min(base * 2 ** exponent, max);
  const ratio = clampRatio(options.jitterRatio);
  const random = options.random ?? Math.random;
  const factor = 1 - ratio + random() * 2 * ratio;
  const delay = Math.round(capped * factor);

  return Math.max(0, Math.min(max, delay));
}

export function decideNextDelay(
  state: ScheduleState,
  options: ScheduleOptions,
): ScheduleDecision {
  const attempt = normalizeAttempt(state.attempt);
  const { base } = delayBounds(options);

  if (state.outcome === 'ok') {
    return { delayMs: base, attempt: 0, backingOff: false, outcome: 'ok' };
  }

  const maxAttempt = Math.max(1, options.maxAttempt ?? DEFAULT_MAX_ATTEMPT);
  const nextAttempt = Math.min(attempt + 1, maxAttempt);

  return {
    delayMs: backoffDelayForAttempt(nextAttempt, options),
    attempt: nextAttempt,
    backingOff: true,
    outcome: state.outcome,
  };
}
